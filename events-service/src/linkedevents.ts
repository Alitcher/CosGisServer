/**
 * Helsinki **Linked Events** import (https://api.hel.fi/linkedevents/v1/).
 *
 * Pulls cosplay/manga community events into our *pending* queue so an admin
 * approves the real ones (existing `POST /v1/submissions/:id/approve` flow).
 *
 * Three guards keep us from re-downloading needlessly:
 *   1. Freshness  - skip the whole run if we synced < TTL ago (unless forced).
 *   2. Incremental - ask upstream only for events changed since our last sync.
 *   3. Dedup      - a unique (source, source_id) index drops re-imports.
 *
 * Data is CC BY 4.0 - attribute "City of Helsinki, CC BY 4.0" where shown.
 */
import type { EventsRepo, EventInput } from "./repo";

const BASE = "https://api.hel.fi/linkedevents/v1/event/";
// High-signal keywords only. `anime` alone is noisy (museum exhibits); skip it.
const KEYWORDS = ["cosplay", "manga"];
const CITIES = new Set(["Helsinki", "Vantaa", "Espoo"]); // our CityEnum
const FRESH_TTL_MS = 12 * 60 * 60 * 1000; // re-sync at most every 12h
const MAX_PAGES = 5; // safety cap; niche queries return far fewer

type Localized = Record<string, string> | null | undefined;
type RawEvent = {
  id: string;
  name?: Localized;
  short_description?: Localized;
  description?: Localized;
  start_time?: string | null;
  last_modified_time?: string | null;
  location?: {
    name?: Localized;
    address_locality?: Localized;
    position?: { coordinates?: [number, number] } | null;
  } | null;
};

const pick = (l: Localized): string | null => l?.fi || l?.en || l?.sv || null;
const stripHtml = (s: string | null): string | undefined =>
  s ? s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() || undefined : undefined;

/** Upstream Linked Events event -> our EventInput, or null if not mappable/in-region. */
export function mapToEventInput(e: RawEvent): (EventInput & { source: string; sourceId: string }) | null {
  const loc = e.location ?? {};
  const coords = loc.position?.coordinates;
  const name = pick(e.name);
  const city = pick(loc.address_locality);
  if (!name || !e.start_time || !coords || coords.length !== 2) return null;
  if (!CITIES.has(city as string)) return null;

  const description = stripHtml(pick(e.short_description) || pick(e.description) || null);
  return {
    name: name.slice(0, 120),
    venue: (pick(loc.name) || "Unknown venue").slice(0, 120),
    city: city as EventInput["city"],
    date: e.start_time.slice(0, 10), // YYYY-MM-DD
    lng: coords[0],
    lat: coords[1],
    ...(description ? { description: description.slice(0, 500) } : {}),
    status: "pending",
    submittedBy: "linkedevents:helsinki",
    source: "linkedevents",
    sourceId: e.id,
  };
}

/** Fetch raw events for one keyword, following pagination up to MAX_PAGES. */
async function fetchKeyword(keyword: string, sinceIso: string | null): Promise<RawEvent[]> {
  const params = new URLSearchParams({
    text: keyword,
    include: "location",
    start: "today", // only upcoming events
    page_size: "100",
    sort: "start_time",
  });
  if (sinceIso) params.set("last_modified_gte", sinceIso); // incremental
  let url: string | null = `${BASE}?${params.toString()}`;
  const out: RawEvent[] = [];
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Linked Events ${keyword} -> HTTP ${res.status}`);
    const json = (await res.json()) as { data?: RawEvent[]; meta?: { next?: string | null } };
    out.push(...(json.data ?? []));
    url = json.meta?.next ?? null;
  }
  return out;
}

export type SyncResult = {
  skipped?: "fresh";
  fetched: number;
  created: number;
  duplicates: number;
  ignored: number; // out of region / unmappable
  lastModified: string | null;
};

/**
 * Run a sync. Returns a summary. Pass `force: true` to bypass the freshness TTL
 * (e.g. an admin pressing "sync now").
 */
export async function syncLinkedEvents(
  repo: EventsRepo,
  db: D1Database,
  opts: { force?: boolean } = {},
): Promise<SyncResult> {
  const state = (await db
    .prepare("SELECT last_run, last_modified FROM sync_state WHERE key = 'linkedevents'")
    .first()) as { last_run?: string; last_modified?: string } | null;

  // Guard 1: freshness - don't even hit the network if we synced recently.
  if (!opts.force && state?.last_run) {
    const age = Date.now() - Date.parse(state.last_run);
    if (Number.isFinite(age) && age < FRESH_TTL_MS) {
      return { skipped: "fresh", fetched: 0, created: 0, duplicates: 0, ignored: 0, lastModified: state.last_modified ?? null };
    }
  }

  // Guard 2: incremental - only events changed since our cursor.
  const since = state?.last_modified ?? null;
  const raw: RawEvent[] = [];
  for (const kw of KEYWORDS) raw.push(...(await fetchKeyword(kw, since)));

  let created = 0,
    duplicates = 0,
    ignored = 0,
    maxModified = since;

  // Dedup within this batch (a con can match both 'cosplay' and 'manga').
  const seen = new Set<string>();
  for (const e of raw) {
    if (e.last_modified_time && (!maxModified || e.last_modified_time > maxModified)) {
      maxModified = e.last_modified_time;
    }
    if (seen.has(e.id)) continue;
    seen.add(e.id);

    const input = mapToEventInput(e);
    if (!input) {
      ignored++;
      continue;
    }
    // Guard 3: dedup against the DB - skip if we already imported this id.
    if (await repo.findBySourceId(input.source, input.sourceId)) {
      duplicates++;
      continue;
    }
    await repo.create(input);
    created++;
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO sync_state (key, last_run, last_modified) VALUES ('linkedevents', ?, ?)
       ON CONFLICT(key) DO UPDATE SET last_run = excluded.last_run, last_modified = excluded.last_modified`,
    )
    .bind(now, maxModified)
    .run();

  return { fetched: raw.length, created, duplicates, ignored, lastModified: maxModified };
}
