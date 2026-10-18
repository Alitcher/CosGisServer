// Turn Linked Events series that were imported meeting by meeting (before the importer
// knew about series) into ONE "community" meetup each, like the importer now does.
//
// For every Linked Events row that is pending or live, ask upstream whether it belongs to a
// series (parent with super_event_type "recurring"). Per series:
//   - the series row (the parent, or the first upcoming meeting when the parent was never
//     imported) becomes kind = community, date = first meeting of this year, later meetings
//     = custom dates (the meetup page lists the whole year), times from the next meeting;
//     it goes live if any of its meetings was already live, otherwise it stays pending;
//   - the single-meeting rows are set to draft (hidden, NOT deleted);
//   - series with the same name, venue and city (e.g. two library groups an hour apart) are
//     combined into one meetup with a time slot per group; the other series rows go to draft.
//
//   node scripts/fix-series.ts --remote            print the plan, change nothing
//   node scripts/fix-series.ts --remote --write    ...and save to production
//   node scripts/fix-series.ts --local --write     ...or to the local dev DB
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DB = "cosplay-map-db";
const BASES: Record<string, string> = {
  linkedevents: "https://api.hel.fi/linkedevents/v1/event/",
  "linkedevents-espoo": "https://api.espoo.fi/events/v1/event/",
};
const MAX_DATES = 60; // RecurrenceSchema limit

const args = process.argv.slice(2);
const target = args.includes("--remote") ? "--remote" : args.includes("--local") ? "--local" : null;
const write = args.includes("--write");
if (!target) {
  console.error("Pick a database: --remote (production) or --local. Add --write to save.");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = (cmd: string) =>
  execSync(`npx wrangler ${cmd}`, { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1" } }).toString();

type Row = { id: string; name: string; venue: string; city: string; date: string; status: string; source: string; source_id: string };
type Raw = { id: string; start_time?: string | null; end_time?: string | null; super_event_type?: string | null; super_event?: { "@id"?: string } | null };

const out = wrangler(
  `d1 execute ${DB} ${target} --json --command "SELECT id, name, venue, city, date, status, source, source_id FROM events WHERE source IN ('linkedevents','linkedevents-espoo') AND status IN ('pending','live') AND source_id IS NOT NULL"`,
);
const rows = (JSON.parse(out) as Array<{ results: Row[] }>)[0].results;

// Helsinki dates and times (Linked Events sends UTC).
const fmtDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki" });
const fmtTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", hour: "2-digit", minute: "2-digit", hour12: false });
const localDate = (iso: string) => fmtDate.format(new Date(iso));
const localTime = (iso: string) => fmtTime.format(new Date(iso));
const today = fmtDate.format(new Date());

const cache = new Map<string, Raw | null>();
async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  return res.ok ? ((await res.json()) as T) : null;
}
async function event(base: string, id: string): Promise<Raw | null> {
  const k = base + id;
  if (!cache.has(k)) cache.set(k, await getJson<Raw>(`${base}${encodeURIComponent(id)}/`));
  return cache.get(k) ?? null;
}
async function meetings(base: string, parentId: string): Promise<Raw[]> {
  let url: string | null = `${base}?${new URLSearchParams({ super_event: parentId, page_size: "100", sort: "start_time" })}`;
  const all: Raw[] = [];
  for (let page = 0; url && page < 5; page++) {
    const json: { data?: Raw[]; meta?: { next?: string | null } } | null = await getJson(url);
    all.push(...(json?.data ?? []));
    url = json?.meta?.next ?? null;
  }
  return all;
}
const idFromUrl = (u?: string) => u?.split("/").filter(Boolean).pop() ?? null;

// Group our rows by the upstream series they belong to.
const groups = new Map<string, { base: string; source: string; rows: Row[] }>();
for (const r of rows) {
  const base = BASES[r.source];
  const e = await event(base, r.source_id);
  if (!e) continue;
  const parentId = e.super_event_type === "recurring" ? e.id : idFromUrl(e.super_event?.["@id"]);
  if (!parentId) continue;
  const parent = parentId === e.id ? e : await event(base, parentId);
  if (parent?.super_event_type !== "recurring") continue; // umbrella (festival) or no series
  const key = `${r.source}|${parentId}`;
  if (!groups.has(key)) groups.set(key, { base, source: r.source, rows: [] });
  groups.get(key)!.rows.push(r);
}

const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;
const statements: string[] = [];
type Slot = { start: string; end?: string };
type Plan = { keep: Row; parentId: string; first: string; dates: string[]; slot: Slot; status: string; drafts: Row[] };
const plans: Plan[] = [];
for (const [key, g] of groups) {
  const parentId = key.split("|")[1];
  const list = (await meetings(g.base, parentId))
    .filter((m) => m.start_time)
    .map((m) => ({ m, date: localDate(m.start_time!) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const thisYear = list.filter((x) => x.date >= `${today.slice(0, 4)}-01-01`);
  const use = thisYear.length ? thisYear : list;
  if (!use.length) continue;
  const first = use[0];
  const nextMeeting = use.find((x) => x.date >= today) ?? first;
  const dates = [...new Set(use.slice(1).map((x) => x.date))].slice(0, MAX_DATES);
  // The parent row if we have it, else the row of the first upcoming meeting (else any).
  const keep =
    g.rows.find((r) => r.source_id === parentId) ??
    g.rows.find((r) => r.source_id === first.m.id) ??
    g.rows.slice().sort((a, b) => a.date.localeCompare(b.date))[0];
  const status = g.rows.some((r) => r.status === "live") ? "live" : keep.status;
  const slot: Slot = { start: localTime(nextMeeting.m.start_time!), ...(nextMeeting.m.end_time ? { end: localTime(nextMeeting.m.end_time) } : {}) };
  plans.push({ keep, parentId, first: first.date, dates, slot, status, drafts: g.rows.filter((r) => r.id !== keep.id) });
}

// Same meetup published as several series (same name, venue, city): one row, a slot per series.
const norm = (s: string) => s.trim().toLowerCase();
const byMeetup = new Map<string, Plan[]>();
for (const p of plans) {
  const k = [p.keep.name, p.keep.venue, p.keep.city].map(norm).join("|");
  byMeetup.set(k, [...(byMeetup.get(k) ?? []), p]);
}
for (const group of byMeetup.values()) {
  const main = group.find((p) => p.status === "live") ?? group[0];
  const first = group.map((p) => p.first).sort()[0];
  const dates = [...new Set(group.flatMap((p) => [p.first, ...p.dates]))].filter((d) => d > first).sort().slice(0, MAX_DATES);
  const slots = [...new Map(group.map((p) => [`${p.slot.start}|${p.slot.end ?? ""}`, p.slot])).values()].sort((x, y) => x.start.localeCompare(y.start));
  const ends = slots.map((s) => s.end).filter((x): x is string => !!x).sort();
  const status = group.some((p) => p.status === "live") ? "live" : main.status;
  const recurrence = JSON.stringify({ freq: "custom", dates, ...(slots.length > 1 ? { slots } : {}) });
  console.log(`\n${main.keep.name}  (${group.length} series, ${group.reduce((n, p) => n + 1 + p.drafts.length, 0)} rows)`);
  console.log(`  keep ${main.keep.id}: community, from ${first}, ${dates.length} more dates, ${slots.map((s) => `${s.start}-${s.end ?? ""}`).join(" + ")}, ${status}`);
  statements.push(
    `UPDATE events SET kind='community', date=${sqlText(first)}, end_date=NULL, ` +
      `start_time=${sqlText(slots[0].start)}, end_time=${ends.length ? sqlText(ends[ends.length - 1]) : "end_time"}, ` +
      `recurrence=${sqlText(recurrence)}, status=${sqlText(status)}, source_id=${sqlText(main.parentId)} WHERE id=${sqlText(main.keep.id)};`,
  );
  const drafts = group.flatMap((p) => (p === main ? p.drafts : [p.keep, ...p.drafts]));
  for (const r of drafts) {
    console.log(`  draft ${r.id}: ${r.date} (${r.status})`);
    statements.push(`UPDATE events SET status='draft' WHERE id=${sqlText(r.id)};`);
  }
}

if (!statements.length) {
  console.log("No series found. Nothing to do.");
} else if (!write) {
  console.log(`\nDry run: ${statements.length} updates planned. Add --write to save.`);
} else {
  const file = path.join(os.tmpdir(), `fix-series-${Date.now()}.sql`);
  fs.writeFileSync(file, statements.join("\n"));
  wrangler(`d1 execute ${DB} ${target} --file "${file}"`);
  fs.rmSync(file, { force: true });
  console.log(`\nSaved ${statements.length} updates.`);
}
