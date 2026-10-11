/**
 * Auto-translation of event/place text into every UI language (en, fi, et, th)
 * with Workers AI (m2m100, `AI` binding in wrangler.toml).
 *
 * An item keeps its own `name`/`description` in its original language (`lang`);
 * the other languages go into `i18n`. Only the description is translated: names
 * are proper names (Ropecon, Kamppi Center) and machine translation mangles them,
 * so names always stay as written. Rules:
 *   - entries with `auto: false` were written by an admin and are never touched;
 *   - other entries are filled when missing, and redone when the original text
 *     changes (`refresh`);
 *   - an item without `lang` gets one guessed from its text (and saved);
 *   - names left in auto entries by older versions are removed.
 *
 * Runs after a save (controllers, in the background) and on the daily cron for
 * items that have none yet (imports, older rows). A failed translation just
 * leaves that language empty; the site falls back to the original text.
 */
import type { Context } from "hono";
import type { I18n, Lang } from "@anime-con/shared";
import type { Bindings } from "../types";

export const LANGS: Lang[] = ["en", "fi", "et", "th"];
const MODEL = "@cf/meta/m2m100-1.2b";

/** Rough language guess for text with no `lang`: script and common words. */
export function guessLang(text: string): Lang {
  if (/[\u0E00-\u0E7F]/.test(text)) return "th";
  const t = text.toLowerCase();
  if (/\u00F5/.test(t) || /\b(ning|toimub|\u00FCritus|kell)\b/.test(t)) return "et";
  if (/[\u00E4\u00F6]/.test(t) || /\b(ja|sek\u00E4|tapahtuma|klo|kirjasto|joka|ovat)\b/.test(t)) return "fi";
  return "en";
}

/** An auto entry still holding a machine-translated name (written before names were skipped). */
const hasAutoName = (i18n: I18n | undefined) => Object.values(i18n ?? {}).some((t) => t?.auto !== false && t?.name);

export type Translatable = { id: string; name: string; description?: string; lang?: Lang; i18n?: I18n };
export type TranslationRepo = { update(id: string, patch: { lang?: Lang; i18n?: I18n }): Promise<unknown> };

async function translate(ai: Ai, text: string | undefined, from: Lang, to: Lang): Promise<string | undefined> {
  if (!text?.trim()) return undefined;
  const out = (await ai.run(MODEL, { text, source_lang: from, target_lang: to })) as { translated_text?: string };
  return out.translated_text?.trim() || undefined;
}

/**
 * Fill in an item's missing translations (all auto ones when `refresh`).
 * Returns true when it saved something.
 */
export async function translateItem(ai: Ai, repo: TranslationRepo, item: Translatable, refresh = false): Promise<boolean> {
  const src = item.lang ?? guessLang(`${item.name} ${item.description ?? ""}`);
  const next: I18n = { ...(item.i18n ?? {}) };
  delete next[src]; // the original text is the source language
  let changed = item.lang !== src;
  for (const to of LANGS) {
    if (to === src) continue;
    const cur = next[to];
    if (cur?.auto === false) continue; // written by hand
    if (cur?.name) { // old machine-translated name: drop it, keep the rest
      const { name: _drop, ...rest } = cur;
      next[to] = rest;
      changed = true;
    }
    if (cur?.description && !refresh) continue; // already translated
    const description = await translate(ai, item.description, src, to);
    if (!description) {
      if (next[to] && !next[to]?.description) delete next[to]; // nothing left in it
      continue;
    }
    next[to] = { description: description.slice(0, 800), auto: true };
    changed = true;
  }
  if (changed) await repo.update(item.id, { lang: src, i18n: next });
  return changed;
}

/**
 * Translate items that have no translations yet (imports, rows from before this
 * feature) or still carry machine-translated names, at most `max` per call so one run stays within limits.
 */
export async function translateMissing(
  ai: Ai,
  sets: Array<{ items: Translatable[]; repo: TranslationRepo }>,
  max = 25,
): Promise<{ translated: number; remaining: number }> {
  const todo = sets.flatMap(({ items, repo }) =>
    items.filter((i) => !i.i18n || Object.keys(i.i18n).length === 0 || hasAutoName(i.i18n)).map((item) => ({ item, repo })),
  );
  let translated = 0;
  for (const { item, repo } of todo.slice(0, max)) {
    try {
      if (await translateItem(ai, repo, item)) translated++;
    } catch (e) {
      console.error("translate failed", item.id, e);
    }
  }
  return { translated, remaining: Math.max(0, todo.length - max) };
}

/** Controllers: translate a just-saved item after the response is sent (never blocks or fails the save). */
export function translateInBackground(
  c: Context<{ Bindings: Bindings }>,
  repo: TranslationRepo,
  item: Translatable | null,
  refresh = false,
): void {
  const ai = c.env.AI;
  if (!ai || !item) return;
  c.executionCtx.waitUntil(translateItem(ai, repo, item, refresh).catch((e) => console.error("translate failed", item.id, e)));
}
