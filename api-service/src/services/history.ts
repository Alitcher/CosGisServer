import type { Context } from "hono";
import type { Bindings } from "../types";
import { sessionSubject } from "../auth/session";

/**
 * Admin history (table admin_history, migration 0015): every admin change to an event or
 * place is stored with the full row before and after, so Admin > History can undo it,
 * redo it, or jump back to any point.
 *
 * Changes made in one admin action share a group: the client sends the same
 * `X-History-Group` id (and an `X-History-Label`, e.g. "Combine 3 events") on each
 * request of that action. Without the headers every request is its own group.
 *
 * Undo / redo write the stored rows back with plain SQL (no validation needed: they
 * came out of the same table). Imports and auto-translations are not recorded.
 */
export type Table = "events" | "places";
type Row = Record<string, unknown>;

/** Who made the change: the passkey (start of its id) or the static admin token. */
export function actorOf(c: Context<{ Bindings: Bindings }>): string {
  const token = (c.req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (c.env.ADMIN_TOKEN && token === c.env.ADMIN_TOKEN) return "admin token";
  const sub = sessionSubject(token);
  return sub ? `passkey ${sub}` : "passkey";
}

/** The full DB row, or null when it doesn't exist. */
export async function snapshot(db: D1Database, table: Table, id: string): Promise<Row | null> {
  return ((await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first()) as Row | null) ?? null;
}

/**
 * Store one admin action. `changes` = the rows it touched; unchanged rows are skipped.
 * `label` is used unless the client sent X-History-Label.
 */
export async function record(
  c: Context<{ Bindings: Bindings }>,
  db: D1Database,
  label: string,
  changes: { table: Table; id: string; before: Row | null; after: Row | null }[],
): Promise<void> {
  const real = changes.filter((ch) => JSON.stringify(ch.before) !== JSON.stringify(ch.after));
  if (!real.length) return;
  const group = (c.req.header("X-History-Group") ?? "").slice(0, 64) || crypto.randomUUID();
  const name = (c.req.header("X-History-Label") ?? "").slice(0, 200) || label;
  const actor = actorOf(c);
  for (const ch of real) {
    await db
      .prepare("INSERT INTO admin_history (group_id, actor, label, tbl, row_id, before, after) VALUES (?,?,?,?,?,?,?)")
      .bind(group, actor, name, ch.table, ch.id, ch.before ? JSON.stringify(ch.before) : null, ch.after ? JSON.stringify(ch.after) : null)
      .run();
  }
}

/**
 * Run an admin write and record it: rows are read before and after `write`.
 * `ids` lists the rows it touches; `write` may return the id of a row it created.
 */
export async function recorded<T>(
  c: Context<{ Bindings: Bindings }>,
  db: D1Database,
  table: Table,
  label: (row: Row | null) => string,
  ids: string[],
  write: () => Promise<T>,
  createdId?: (result: T) => string | undefined,
): Promise<T> {
  const before = await Promise.all(ids.map((id) => snapshot(db, table, id)));
  const result = await write();
  const newId = createdId?.(result);
  const all = newId ? [...ids, newId] : ids;
  const changes = await Promise.all(
    all.map(async (id, i) => ({ table, id, before: before[i] ?? null, after: await snapshot(db, table, id) })),
  );
  const named = changes.find((ch) => ch.after ?? ch.before);
  // The change itself is done: a failing history write (e.g. table missing before
  // migration 0015) must not turn a good save into an error.
  await record(c, db, label((named?.after ?? named?.before) || null), changes).catch((err) => console.error("history record failed", err));
  return result;
}

/** Write a stored row back (null = the row didn't exist: delete it). */
async function restore(db: D1Database, table: Table, id: string, row: Row | null): Promise<void> {
  if (!row) {
    await db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
    return;
  }
  const cols = Object.keys(row).filter((k) => /^[a-z_0-9]+$/.test(k));
  await db
    .prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .bind(...cols.map((k) => row[k] ?? null))
    .run();
}

type Entry = { id: number; group_id: string; at: string; actor: string; label: string; tbl: Table; row_id: string; before: string | null; after: string | null; undone: number };

export type HistoryGroup = {
  group: string; at: string; actor: string; label: string; undone: boolean;
  rows: { table: Table; id: string; name: string; change: "created" | "edited" | "deleted" }[];
};

/** Newest admin actions first, `limit` groups. */
export async function listHistory(db: D1Database, limit = 100): Promise<HistoryGroup[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM admin_history WHERE group_id IN (SELECT group_id FROM admin_history GROUP BY group_id ORDER BY MAX(id) DESC LIMIT ?) ORDER BY id",
    )
    .bind(limit)
    .all();
  const groups = new Map<string, HistoryGroup>();
  for (const e of results as Entry[]) {
    const g = groups.get(e.group_id) ?? { group: e.group_id, at: e.at, actor: e.actor, label: e.label, undone: true, rows: [] };
    const row = JSON.parse(e.after ?? e.before ?? "{}") as Row;
    g.rows.push({ table: e.tbl, id: e.row_id, name: String(row.name ?? e.row_id), change: !e.before ? "created" : !e.after ? "deleted" : "edited" });
    g.undone &&= e.undone === 1;
    g.at = e.at;
    groups.set(e.group_id, g);
  }
  return [...groups.values()].reverse();
}

async function entries(db: D1Database, group: string): Promise<Entry[]> {
  const { results } = await db.prepare("SELECT * FROM admin_history WHERE group_id = ? ORDER BY id").bind(group).all();
  return results as Entry[];
}

/** Later, still-active actions that touched the same rows (undo / redo would overwrite them). */
async function newerConflicts(db: D1Database, list: Entry[]): Promise<string[]> {
  const last = Math.max(...list.map((e) => e.id));
  const out = new Set<string>();
  for (const e of list) {
    const { results } = await db
      .prepare("SELECT label FROM admin_history WHERE tbl = ? AND row_id = ? AND id > ? AND undone = 0 AND group_id <> ?")
      .bind(e.tbl, e.row_id, last, e.group_id)
      .all();
    for (const r of results as { label: string }[]) out.add(r.label);
  }
  return [...out];
}

export type UndoResult = { ok: true } | { ok: false; error: string; conflicts?: string[] };

/** Undo one action: its rows go back to how they were before it (newest change first). */
export async function undoGroup(db: D1Database, group: string, force = false): Promise<UndoResult> {
  const list = await entries(db, group);
  if (!list.length) return { ok: false, error: "Not found" };
  if (list.every((e) => e.undone)) return { ok: false, error: "Already undone" };
  const conflicts = force ? [] : await newerConflicts(db, list);
  if (conflicts.length) return { ok: false, error: "Later changes touch the same rows. Use 'Jump here' on an older line, or undo those first.", conflicts };
  for (const e of [...list].reverse()) await restore(db, e.tbl, e.row_id, e.before ? (JSON.parse(e.before) as Row) : null);
  await db.prepare("UPDATE admin_history SET undone = 1 WHERE group_id = ?").bind(group).run();
  return { ok: true };
}

/** Redo an undone action: its rows go back to how it left them. */
export async function redoGroup(db: D1Database, group: string, force = false): Promise<UndoResult> {
  const list = await entries(db, group);
  if (!list.length) return { ok: false, error: "Not found" };
  if (list.every((e) => !e.undone)) return { ok: false, error: "Not undone" };
  const conflicts = force ? [] : await newerConflicts(db, list);
  if (conflicts.length) return { ok: false, error: "Later changes touch the same rows. Undo those first.", conflicts };
  for (const e of list) await restore(db, e.tbl, e.row_id, e.after ? (JSON.parse(e.after) as Row) : null);
  await db.prepare("UPDATE admin_history SET undone = 0 WHERE group_id = ?").bind(group).run();
  return { ok: true };
}

/**
 * Jump to a point in the history: every action after `group` is undone (newest first) and
 * every undone action up to and including it is redone (oldest first), so the data looks
 * like it did right after that action.
 */
export async function jumpTo(db: D1Database, group: string): Promise<UndoResult> {
  const { results } = await db
    .prepare("SELECT group_id, MAX(id) AS last, MIN(undone) AS undone FROM admin_history GROUP BY group_id ORDER BY last")
    .all();
  const order = results as { group_id: string; last: number; undone: number }[];
  const at = order.findIndex((g) => g.group_id === group);
  if (at < 0) return { ok: false, error: "Not found" };
  for (const g of order.slice(at + 1).reverse()) if (g.undone === 0) await undoGroup(db, g.group_id, true);
  for (const g of order.slice(0, at + 1)) if (g.undone === 1) await redoGroup(db, g.group_id, true);
  return { ok: true };
}
