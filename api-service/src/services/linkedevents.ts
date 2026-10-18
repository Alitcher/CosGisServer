/**
 * **Linked Events** import. Linked Events is the open event API several Finnish
 * cities run with the same schema; each one is an `Instance` below:
 *   - Helsinki (https://api.hel.fi/linkedevents/v1/) - Helsinki, Vantaa, Espoo
 *   - Espoo    (https://api.espoo.fi/events/v1/)      - Espoo's own calendar
 *
 * Pulls cosplay/manga community events into our *pending* queue so an admin
 * approves the real ones (existing `POST /v1/events/submissions/:id/approve`).
 *
 * Repeating meetups: Linked Events publishes them as a series - a parent event with
 * `super_event_type: "recurring"` and one sub event per meeting (`super_event` points
 * back). We import the PARENT once as a "community" event whose custom dates are the
 * meeting dates, and skip the single meetings. Umbrella parents (festivals) and
 * stand-alone events stay conventions.
 *
 * Three guards keep us from re-downloading needlessly:
 *   1. Freshness  - skip the whole run if we synced < TTL ago (unless forced).
 *   2. Incremental - ask upstream only for events changed since our last sync.
 *   3. Dedup      - a unique (source, source_id) index drops re-imports.
 *
 * Data is CC BY 4.0 - attribute the city (e.g. "City of Helsinki, CC BY 4.0") where shown.
 */
import type { Event } from "@anime-con/shared";
import type { EventsRepo, EventInput } from "../repositories/events.repo";
import { localDate, localTime } from "./helsinki-time";

export type Instance = {
  key: string;          // sync_state key and `source` value (dedup is per source)
  base: string;         // .../event/ endpoint
  label: string;        // shown in `submittedBy`, e.g. "linkedevents:espoo"
  cities?: Set<string>; // only keep events in these localities; undefined = any
};

// Key and source stay "linkedevents" so Helsinki rows imported before Espoo existed still dedupe.
export const HELSINKI: Instance = {
  key: "linkedevents",
  base: "https://api.hel.fi/linkedevents/v1/event/",
  label: "helsinki",
  cities: new Set(["Helsinki", "Vantaa", "Espoo"]),
};
export const ESPOO: Instance = {
  key: "linkedevents-espoo",
  base: "https://api.espoo.fi/events/v1/event/",
  label: "espoo",
};

// High-signal keywords only. `anime` alone is noisy (museum exhibits); skip it.
const KEYWORDS = ["cosplay", "manga"];
const FRESH_TTL_MS = 12 * 60 * 60 * 1000; // re-sync at most every 12h
const MAX_PAGES = 5; // safety cap; niche queries return far fewer

type Localized = Record<string, string> | null | undefined;
type RawEvent = {
  id: string;
  name?: Localized;
  short_description?: Localized;
  description?: Localized;
  info_url?: Localized;
  images?: Array<{ url?: string | null }> | null; // inline image objects, first = main picture
  start_time?: string | null;
  end_time?: string | null;
  last_modified_time?: string | null;
  super_event_type?: string | null;         // "recurring" (a series of meetings) | "umbrella" (festival) | null
  super_event?: { "@id"?: string } | null;  // set on each single meeting of a series
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
export function mapToEventInput(
  e: RawEvent,
  inst: Instance = HELSINKI,
): (EventInput & { source: string; sourceId: string }) | null {
  const loc = e.location ?? {};
  const coords = loc.position?.coordinates;
  const name = pick(e.name);
  const city = pick(loc.address_locality);
  if (!name || !e.start_time || !coords || coords.length !== 2) return null;
  if (!city || (inst.cities && !inst.cities.has(city))) return null;

  const description = stripHtml(pick(e.short_description) || pick(e.description) || null);
  const infoUrl = pick(e.info_url);
  const url = infoUrl && /^https?:\/\//i.test(infoUrl) ? infoUrl.slice(0, 500) : undefined;
  const imageUrl = e.images?.[0]?.url;
  const image = imageUrl && /^https?:\/\//i.test(imageUrl) && imageUrl.length <= 500 ? imageUrl : undefined;
  // Times arrive in UTC; convert so the date doesn't slip a day late in the evening.
  const date = localDate(e.start_time);
  if (!date) return null;
  const endDate = e.end_time ? localDate(e.end_time) : null;
  const startTime = localTime(e.start_time);
  const endTime = e.end_time ? localTime(e.end_time) : null;
  return {
    name: name.slice(0, 120),
    venue: (pick(loc.name) || "Unknown venue").slice(0, 120),
    city,
    country: "FI",
    date,
    ...(endDate && endDate > date ? { endDate } : {}),
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
    lng: coords[0],
    lat: coords[1],
    ...(description ? { description: description.slice(0, 500) } : {}),
    ...(url ? { url } : {}),
    ...(image ? { image } : {}),
    status: "pending",
    submittedBy: `linkedevents:${inst.label}`,
    source: inst.key,
    sourceId: e.id,
  };
}

type Imported = EventInput & { source: string; sourceId: string };
const MAX_DATES = 60; // RecurrenceSchema limit

/** Linked Events id from an API link, e.g. ".../event/helsinki:agpzf7zfcy/" -> "helsinki:agpzf7zfcy". */
const idFromUrl = (u?: string): string | null => u?.split("/").filter(Boolean).pop() ?? null;

/**
 * A recurring series -> ONE community event: name, place and text from the parent,
 * first upcoming meeting as `date` (with that meeting's times), the later meetings as
 * custom dates. Past meetings are left out. Null if the parent can't be mapped.
 */
export function seriesToEventInput(parent: RawEvent, meetings: RawEvent[], inst: Instance = HELSINKI, today = localDate(new Date().toISOString())): Imported | null {
  const base = mapToEventInput(parent, inst);
  if (!base) return null;
  const starts = meetings
    .filter((m) => m.start_time)
    .map((m) => ({ m, date: localDate(m.start_time!) }))
    .filter((x): x is { m: RawEvent; date: string } => !!x.date)
    .sort((x, y) => x.date.localeCompare(y.date));
  const upcoming = starts.filter((x) => !today || x.date >= today);
  const list = upcoming.length ? upcoming : starts;
  const first = list[0];
  const { endDate: _endDate, startTime: _startTime, endTime: _endTime, ...rest } = base;
  const startTime = first?.m.start_time ? localTime(first.m.start_time) : base.startTime;
  const endTime = first?.m.end_time ? localTime(first.m.end_time) : null;
  return {
    ...rest,
    date: first?.date ?? base.date,
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
    kind: "community",
    recurrence: { freq: "custom", dates: [...new Set(list.slice(1).map((x) => x.date))].slice(0, MAX_DATES) },
  };
}

async function getJson<T>(url: string, inst: Instance): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Linked Events (${inst.label}) ${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** One event with its place. */
const fetchEvent = (inst: Instance, id: string) => getJson<RawEvent>(`${inst.base}${encodeURIComponent(id)}/?include=location`, inst);

/** Every meeting (sub event) of a series, soonest first. */
async function fetchMeetings(inst: Instance, parentId: string): Promise<RawEvent[]> {
  let url: string | null = `${inst.base}?${new URLSearchParams({ super_event: parentId, page_size: "100", sort: "start_time" })}`;
  const out: RawEvent[] = [];
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const json: { data?: RawEvent[]; meta?: { next?: string | null } } = await getJson(url, inst);
    out.push(...(json.data ?? []));
    url = json.meta?.next ?? null;
  }
  return out;
}

/**
 * Update a series we imported before: the first date moves to the next meeting and new
 * meetings are added to its custom dates (dates added by hand are kept).
 * Left alone when an admin set a weekly / biweekly / monthly repeat by hand.
 */
export function seriesPatch(existing: Event, input: Imported): Partial<EventInput> {
  const r = existing.recurrence;
  if (r && r.freq !== "custom") return {};
  const date = input.date;
  const dates = [...new Set([...(r?.dates ?? []), ...(input.recurrence?.dates ?? [])])]
    .filter((d) => d > date)
    .sort()
    .slice(0, MAX_DATES);
  const same = existing.kind === "community" && existing.date === date && JSON.stringify(r?.dates ?? []) === JSON.stringify(dates);
  return same ? {} : { kind: "community", date, recurrence: { ...(r ?? {}), freq: "custom", dates } };
}

/** Fetch raw events for one keyword, following pagination up to MAX_PAGES. */
async function fetchKeyword(inst: Instance, keyword: string, sinceIso: string | null): Promise<RawEvent[]> {
  const params = new URLSearchParams({
    text: keyword,
    include: "location",
    start: "today", // only upcoming events
    page_size: "100",
    sort: "start_time",
  });
  if (sinceIso) params.set("last_modified_gte", sinceIso); // incremental
  let url: string | null = `${inst.base}?${params.toString()}`;
  const out: RawEvent[] = [];
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Linked Events (${inst.label}) ${keyword} -> HTTP ${res.status}`);
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
  series: number;  // repeating meetups (Linked Events series) imported or refreshed as one community event
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
  inst: Instance = HELSINKI,
): Promise<SyncResult> {
  const state = (await db
    .prepare("SELECT last_run, last_modified FROM sync_state WHERE key = ?")
    .bind(inst.key)
    .first()) as { last_run?: string; last_modified?: string } | null;

  // Guard 1: freshness - don't even hit the network if we synced recently.
  if (!opts.force && state?.last_run) {
    const age = Date.now() - Date.parse(state.last_run);
    if (Number.isFinite(age) && age < FRESH_TTL_MS) {
      return { skipped: "fresh", fetched: 0, created: 0, duplicates: 0, series: 0, ignored: 0, lastModified: state.last_modified ?? null };
    }
  }

  // Guard 2: incremental - only events changed since our cursor.
  const since = state?.last_modified ?? null;
  const raw: RawEvent[] = [];
  for (const kw of KEYWORDS) raw.push(...(await fetchKeyword(inst, kw, since)));

  let created = 0,
    duplicates = 0,
    series = 0,
    ignored = 0,
    maxModified = since;
  // Series parents: fetched once per run (several meetings point to the same one).
  const parents = new Map<string, RawEvent | null>();
  const parentOf = async (id: string) => {
    if (!parents.has(id)) parents.set(id, await fetchEvent(inst, id).catch(() => null));
    return parents.get(id) ?? null;
  };
  const doneSeries = new Set<string>();

  // Dedup within this batch (a con can match both 'cosplay' and 'manga').
  const seen = new Set<string>();
  for (const e of raw) {
    if (e.last_modified_time && (!maxModified || e.last_modified_time > maxModified)) {
      maxModified = e.last_modified_time;
    }
    if (seen.has(e.id)) continue;
    seen.add(e.id);

    // Part of a repeating series? Then import the series (once), not this single meeting.
    const parentId = e.super_event_type === "recurring" ? e.id : idFromUrl(e.super_event?.["@id"]);
    const parent = parentId ? (parentId === e.id ? e : await parentOf(parentId)) : null;
    if (parentId && parent?.super_event_type === "recurring") {
      if (doneSeries.has(parentId)) continue;
      doneSeries.add(parentId);
      const sInput = seriesToEventInput(parent.location ? parent : ((await parentOf(parentId)) ?? parent), await fetchMeetings(inst, parentId), inst);
      if (!sInput) {
        ignored++;
        continue;
      }
      const old = await repo.findBySourceId(sInput.source, sInput.sourceId);
      if (old) {
        const patch = seriesPatch(old, sInput);
        if (Object.keys(patch).length) await repo.update(old.id, patch);
      } else {
        await repo.create(sInput);
      }
      series++;
      continue;
    }

    const input = mapToEventInput(e, inst);
    if (!input) {
      ignored++;
      continue;
    }
    // Guard 3: dedup against the DB - skip if we already imported this id.
    const existing = await repo.findBySourceId(input.source, input.sourceId);
    if (existing) {
      // Backfill fields onto rows imported before we captured them.
      const patch: Partial<EventInput> = {};
      if (!existing.url && input.url) patch.url = input.url;
      if (!existing.endDate && input.endDate) patch.endDate = input.endDate;
      if (!existing.image && input.image) patch.image = input.image;
      if (!existing.startTime && input.startTime) patch.startTime = input.startTime;
      if (!existing.endTime && input.endTime) patch.endTime = input.endTime;
      if (Object.keys(patch).length) await repo.update(existing.id, patch);
      duplicates++;
      continue;
    }
    await repo.create(input);
    created++;
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO sync_state (key, last_run, last_modified) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET last_run = excluded.last_run, last_modified = excluded.last_modified`,
    )
    .bind(inst.key, now, maxModified)
    .run();

  return { fetched: raw.length, created, duplicates, series, ignored, lastModified: maxModified };
}
