/**
 * conit.fi import via Kompassi (https://kompassi.eu/api/v1/listings/conit.fi).
 *
 * conit.fi is the canonical calendar of Finnish fan conventions (Tracon, Desucon,
 * Kotae, Ropecon, Animecon, ...). Unlike Linked Events it is nationwide, which is
 * the whole reason we pull it: Linked Events only covers cities that run their own
 * instance, so Tampere/Lahti/Oulu cons never show up there.
 *
 * The feed is small, unpaginated, and upcoming-only:
 *   { hostname, title, events: [{ slug, name, headline, venue_name,
 *                                 homepage_url, start_time, end_time, cancelled }] }
 *
 * Two things it does NOT give us, which shape the code below:
 *   - No coordinates. We resolve `venue_name` against a static gazetteer, then
 *     against venues we already have in the database. Anything unresolved is
 *     SKIPPED and reported, never pinned at a guessed location.
 *   - No last-modified field, so no incremental cursor. We refetch the whole feed
 *     (a few hundred bytes) behind a freshness TTL and dedupe on (source, slug).
 *
 * Imports land as `pending` for the existing admin approval flow, same as
 * `linkedevents.ts`.
 *
 * Licence: Kompassi does not state terms on this endpoint. Confirm with the
 * maintainers before displaying the data with an explicit licence claim.
 */
import type { EventsRepo, EventInput } from "../repositories/events.repo";
import type { City } from "@anime-con/shared";

const FEED = "https://kompassi.eu/api/v1/listings/conit.fi";
const FRESH_TTL_MS = 12 * 60 * 60 * 1000; // re-sync at most every 12h
const SYNC_KEY = "conit";

type RawEvent = {
  slug?: string;
  name?: string;
  headline?: string;
  venue_name?: string;
  homepage_url?: string;
  start_time?: string | null;
  end_time?: string | null;
  cancelled?: boolean;
};

type Geo = { lng: number; lat: number; city: City };

/**
 * Known convention venues, coordinates verified against OpenStreetMap.
 *
 * Cons reuse the same halls year after year, so a short list covers most of the
 * feed. Keys are normalised (see `normalise`) - add new entries in that form.
 * A venue missing here still resolves if any event or place in our database
 * already sits at that venue, so the gazetteer effectively grows as admins
 * approve imports.
 */
const VENUES: Record<string, Geo> = {
  // Tampere
  "tampere talo": { lng: 23.7824, lat: 61.4959, city: "Tampere" },
  "tampereen messu ja urheilukeskus": { lng: 23.7347, lat: 61.4644, city: "Tampere" },
  // Helsinki
  "messukeskus": { lng: 24.9364, lat: 60.2030, city: "Helsinki" },
  "helsingin messukeskus": { lng: 24.9364, lat: 60.2030, city: "Helsinki" },
  "kaapelitehdas": { lng: 24.9052, lat: 60.1619, city: "Helsinki" },
  "kulttuuritalo": { lng: 24.9440, lat: 60.1884, city: "Helsinki" },
  "wanha satama": { lng: 24.9675, lat: 60.1655, city: "Helsinki" },
  // Espoo
  "dipoli": { lng: 24.8325, lat: 60.1851, city: "Espoo" },
  "espoon kulttuurikeskus": { lng: 24.8045, lat: 60.1779, city: "Espoo" },
  // Vantaa
  "vantaa energia areena": { lng: 24.8386, lat: 60.2599, city: "Vantaa" },
  // Lahti
  "sibeliustalo": { lng: 25.6516, lat: 60.9950, city: "Lahti" },
  "lahden messukeskus": { lng: 25.6364, lat: 60.9854, city: "Lahti" },
  // Turku
  "logomo": { lng: 22.2578, lat: 60.4569, city: "Turku" },
  "turun messukeskus": { lng: 22.1849, lat: 60.4538, city: "Turku" },
  "turun yliopisto": { lng: 22.2864, lat: 60.4561, city: "Turku" },
  // Jyvaskyla
  "paviljonki": { lng: 25.7588, lat: 62.2394, city: "Jyvaskyla" },
  "jyvaskylan paviljonki": { lng: 25.7588, lat: 62.2394, city: "Jyvaskyla" },
  "jyvaskylan yliopisto": { lng: 25.7358, lat: 62.2318, city: "Jyvaskyla" },
  // Oulu
  "ouluhalli": { lng: 25.5015, lat: 65.0075, city: "Oulu" },
  "oulun teatteri": { lng: 25.4624, lat: 65.0146, city: "Oulu" },
  "oulun kaupunginteatteri": { lng: 25.4624, lat: 65.0146, city: "Oulu" },
  // Kuopio
  "kuopio halli": { lng: 27.6598, lat: 62.8974, city: "Kuopio" },
};

/**
 * Fold a venue name to a gazetteer key: lower case, strip Finnish diacritics,
 * drop punctuation. "Tampere-talo" and "Tampereen Messu- ja Urheilukeskus" are
 * written many ways upstream, so matching on the bare words is more robust.
 */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // combining accents, so a-umlaut -> a
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** YYYY-MM-DD in Helsinki local time. Slicing the UTC string is off by a day for
 *  anything starting late evening, which is exactly when cons run. */
const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Helsinki",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function localDate(iso: string): string | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? dateFmt.format(new Date(t)) : null;
}

/** Look up a venue we already hold coordinates for. Cons repeat annually, so last
 *  year's approved row geolocates this year's edition. */
async function lookupKnownVenue(db: D1Database, venue: string): Promise<Geo | null> {
  const row = (await db
    .prepare(
      `SELECT lng, lat, city FROM events WHERE venue = ?1 COLLATE NOCASE
       UNION ALL
       SELECT lng, lat, city FROM places WHERE name = ?1 COLLATE NOCASE
       LIMIT 1`,
    )
    .bind(venue)
    .first()) as { lng: number; lat: number; city: string } | null;
  return row ? { lng: Number(row.lng), lat: Number(row.lat), city: row.city as City } : null;
}

/** Upstream con -> our EventInput. Null when the row is too incomplete to import.
 *  Coordinates are resolved by the caller and passed in. */
export function mapToEventInput(
  e: RawEvent,
  geo: Geo,
): (EventInput & { source: string; sourceId: string }) | null {
  if (!e.slug || !e.name || !e.start_time) return null;
  const date = localDate(e.start_time);
  if (!date) return null;

  const endDate = e.end_time ? localDate(e.end_time) : null;
  const url =
    e.homepage_url && /^https?:\/\//i.test(e.homepage_url) ? e.homepage_url.slice(0, 500) : undefined;
  const description = e.headline?.replace(/\s+/g, " ").trim() || undefined;

  return {
    name: e.name.slice(0, 120),
    venue: (e.venue_name || "Unknown venue").slice(0, 120),
    city: geo.city,
    date,
    ...(endDate && endDate > date ? { endDate } : {}),
    lng: geo.lng,
    lat: geo.lat,
    ...(description ? { description: description.slice(0, 500) } : {}),
    ...(url ? { url } : {}),
    status: "pending",
    submittedBy: "conit.fi",
    source: SYNC_KEY,
    sourceId: e.slug,
  };
}

export type ConitSyncResult = {
  skipped?: "fresh";
  fetched: number;
  created: number;
  duplicates: number;
  ignored: number;
  /** Venue names with no known coordinates. Add them to VENUES, or approve one
   *  event at that venue by hand and the next sync resolves the rest. */
  unresolved: string[];
  /** Slugs the feed now marks cancelled that we have already imported. Needs a
   *  human: we never unpublish or delete rows automatically. */
  cancelled: string[];
};

/**
 * Run a sync. Pass `force: true` to bypass the freshness TTL (admin "sync now").
 */
export async function syncConit(
  repo: EventsRepo,
  db: D1Database,
  opts: { force?: boolean } = {},
): Promise<ConitSyncResult> {
  const empty = { fetched: 0, created: 0, duplicates: 0, ignored: 0, unresolved: [], cancelled: [] };

  const state = (await db
    .prepare("SELECT last_run FROM sync_state WHERE key = ?")
    .bind(SYNC_KEY)
    .first()) as { last_run?: string } | null;

  // Freshness guard - the feed changes a few times a year, not a few times a day.
  if (!opts.force && state?.last_run) {
    const age = Date.now() - Date.parse(state.last_run);
    if (Number.isFinite(age) && age < FRESH_TTL_MS) return { skipped: "fresh", ...empty };
  }

  const res = await fetch(FEED, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`conit.fi -> HTTP ${res.status}`);
  const feed = (await res.json()) as { events?: RawEvent[] };
  const raw = feed.events ?? [];

  let created = 0;
  let duplicates = 0;
  let ignored = 0;
  const unresolved = new Set<string>();
  const cancelled: string[] = [];
  const today = dateFmt.format(new Date());

  for (const e of raw) {
    if (!e.slug) {
      ignored++;
      continue;
    }

    const existing = await repo.findBySourceId(SYNC_KEY, e.slug);

    // A cancelled con we already imported is the admin's call, not ours.
    if (e.cancelled) {
      if (existing) cancelled.push(e.slug);
      else ignored++;
      continue;
    }

    // Defensive: the listing is upcoming-only, but don't import a past con if that
    // ever changes.
    const last = (e.end_time && localDate(e.end_time)) || (e.start_time && localDate(e.start_time));
    if (last && last < today) {
      ignored++;
      continue;
    }

    const venue = e.venue_name?.trim();
    if (!venue) {
      ignored++;
      continue;
    }
    const geo = VENUES[normalise(venue)] ?? (await lookupKnownVenue(db, venue));
    if (!geo) {
      unresolved.add(venue);
      continue;
    }

    const input = mapToEventInput(e, geo);
    if (!input) {
      ignored++;
      continue;
    }

    if (existing) {
      // Backfill only what is missing. An admin may have corrected the venue,
      // coordinates or dates after approval - don't overwrite that work.
      const patch: Partial<EventInput> = {};
      if (!existing.url && input.url) patch.url = input.url;
      if (!existing.endDate && input.endDate) patch.endDate = input.endDate;
      if (!existing.description && input.description) patch.description = input.description;
      if (Object.keys(patch).length) await repo.update(existing.id, patch);
      duplicates++;
      continue;
    }

    await repo.create(input);
    created++;
  }

  await db
    .prepare(
      `INSERT INTO sync_state (key, last_run, last_modified) VALUES (?, ?, NULL)
       ON CONFLICT(key) DO UPDATE SET last_run = excluded.last_run`,
    )
    .bind(SYNC_KEY, new Date().toISOString())
    .run();

  return {
    fetched: raw.length,
    created,
    duplicates,
    ignored,
    unresolved: [...unresolved],
    cancelled,
  };
}
