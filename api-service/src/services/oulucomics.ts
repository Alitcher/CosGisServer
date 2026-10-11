/**
 * Oulu Comics Center import (https://www.oulucomics.com/en_US/keskus/).
 *
 * Oulu has no Linked Events instance and conit.fi only lists big conventions, so
 * the comics center's own WordPress event list is the only feed for Oulu. It is an
 * RSS feed (/en_US/feed/event-list) holding every event since 2014, oldest first.
 *
 * Each item only has a title, a pubDate and a description, in a fixed format:
 *   title:       "Nov 28, 2026-Jan 27, 2027 - Mika Kolehmainen - Kuvituksia ..."
 *   description: "Nov 5, 2026 18.00- - Oulun Sarjakuvakeskus, Hallituskatu 7, Oulu"
 * i.e. "<dates> - <name>" and "<dates> <time> - <venue, address>". No coordinates,
 * no link, no id, so:
 *   - venues resolve by street address against a short gazetteer; anything else is
 *     SKIPPED and reported (never pinned at a guessed spot), like conit.ts;
 *   - the dedup id is "<start date>:<name>".
 *
 * Mostly comics events (meetups, exhibitions, book launches), so imports land as
 * `pending` and an admin keeps the ones that fit the map.
 */
import type { EventsRepo, EventInput } from "../repositories/events.repo";

const FEED = "https://www.oulucomics.com/en_US/feed/event-list";
const EVENTS_PAGE = "https://www.oulucomics.com/en_US/keskus/allevents/";
const FRESH_TTL_MS = 12 * 60 * 60 * 1000; // re-sync at most every 12h
const SYNC_KEY = "oulucomics";

/** Known addresses (normalised, see `normalise`), coordinates from OpenStreetMap. */
const ADDRESSES: Record<string, { lng: number; lat: number }> = {
  "hallituskatu 7": { lng: 25.4703, lat: 65.0142 }, // Kulttuuritalo Valve: Sarjakuvakeskus + Comics Gallery
  "hallituskatu 9": { lng: 25.4739, lat: 65.0136 }, // Oulun kirjallisuuden talo, opposite the city hall
  "kaarlenvayla 3": { lng: 25.4634, lat: 65.0154 }, // Keskustakirjasto Saari (central library)
};

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

function normalise(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** The few entities WordPress puts in feed text. */
function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .trim();
}

const tag = (block: string, name: string): string =>
  decode((block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) ?? [])[1] ?? "");

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Leading date or date range of a title/description:
 *   "Dec 3, 2026" | "Oct 9-Nov 25, 2026" | "Nov 28, 2026-Jan 27, 2027" | "Mar 3-5, 2026"
 * Returns the dates and how many characters the date text took.
 */
export function parseDates(text: string): { date: string; endDate?: string; length: number } | null {
  const m = text.match(/^([A-Z][a-z]{2}) (\d{1,2})(?:, (\d{4}))?(?:-(?:([A-Z][a-z]{2}) )?(\d{1,2}), (\d{4}))?/);
  if (!m) return null;
  const [all, mon1, d1, y1, mon2, d2, y2] = m;
  const startMonth = MONTHS[mon1!];
  const startYear = Number(y1 ?? y2);
  if (!startMonth || !startYear) return null;
  const date = iso(startYear, startMonth, Number(d1));
  if (!d2) return { date, length: all.length };
  const endMonth = mon2 ? MONTHS[mon2] : startMonth;
  if (!endMonth) return null;
  const endDate = iso(Number(y2), endMonth, Number(d2));
  return { date, ...(endDate > date ? { endDate } : {}), length: all.length };
}

/** "18.00-" -> 18:00; "17:00 - 18:30" -> 17:00/18:30; "12-21" -> 12:00/21:00. */
export function parseTimes(text: string): { startTime?: string; endTime?: string } {
  const hm = [...text.matchAll(/(\d{1,2})[.:](\d{2})/g)].map((x) => `${x[1]!.padStart(2, "0")}:${x[2]}`);
  if (hm.length) return { startTime: hm[0], ...(hm[1] ? { endTime: hm[1] } : {}) };
  const hours = text.match(/\b(\d{1,2})\s*-\s*(\d{1,2})\b/);
  if (hours) return { startTime: `${hours[1]!.padStart(2, "0")}:00`, endTime: `${hours[2]!.padStart(2, "0")}:00` };
  return {};
}

type Item = { title: string; description: string; content: string };

export type OuluSyncResult = {
  skipped?: "fresh";
  fetched: number;
  created: number;
  duplicates: number;
  ignored: number; // past or unparseable
  /** Venues with no known coordinates. Add their address to ADDRESSES. */
  unresolved: string[];
};

/** One feed item -> our EventInput, or a reason it can't be imported. */
export function mapItem(
  item: Item,
  today: string,
): (EventInput & { source: string; sourceId: string }) | "skip" | { unresolved: string } {
  const dates = parseDates(item.title);
  if (!dates) return "skip";
  if ((dates.endDate ?? dates.date) < today) return "skip"; // upcoming / ongoing only
  const name = item.title.slice(dates.length).replace(/^\s*-\s*/, "").trim();
  if (!name) return "skip";

  // description = "<dates> <time> - <venue, address>"; time itself may contain " - ".
  const descDates = parseDates(item.description);
  const rest = descDates ? item.description.slice(descDates.length) : item.description;
  const cut = rest.lastIndexOf(" - ");
  const place = (cut >= 0 ? rest.slice(cut + 3) : rest).trim();
  const times = parseTimes(cut >= 0 ? rest.slice(0, cut) : "");

  const geoKey = Object.keys(ADDRESSES).find((k) => normalise(place).includes(k));
  if (!geoKey) return { unresolved: place || name };
  const geo = ADDRESSES[geoKey]!;

  // content = description + the event text; keep the text part only.
  const extra = item.content.startsWith(item.description) ? item.content.slice(item.description.length) : item.content;
  const description = extra.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  return {
    name: name.slice(0, 120),
    venue: (place.split(",")[0] || "Oulun Sarjakuvakeskus").trim().slice(0, 120),
    city: "Oulu",
    country: "FI",
    date: dates.date,
    ...(dates.endDate ? { endDate: dates.endDate } : {}),
    ...times,
    lng: geo.lng,
    lat: geo.lat,
    ...(description ? { description: description.slice(0, 500) } : {}),
    url: EVENTS_PAGE,
    status: "pending",
    submittedBy: "oulucomics.com",
    source: SYNC_KEY,
    sourceId: `${dates.date}:${normalise(name).slice(0, 80)}`,
  };
}

/** Run a sync. Pass `force: true` to bypass the freshness TTL (admin "sync now"). */
export async function syncOuluComics(
  repo: EventsRepo,
  db: D1Database,
  opts: { force?: boolean } = {},
): Promise<OuluSyncResult> {
  const empty = { fetched: 0, created: 0, duplicates: 0, ignored: 0, unresolved: [] };
  const state = (await db.prepare("SELECT last_run FROM sync_state WHERE key = ?").bind(SYNC_KEY).first()) as
    | { last_run?: string }
    | null;
  if (!opts.force && state?.last_run) {
    const age = Date.now() - Date.parse(state.last_run);
    if (Number.isFinite(age) && age < FRESH_TTL_MS) return { skipped: "fresh", ...empty };
  }

  const res = await fetch(FEED, { headers: { Accept: "application/rss+xml, text/xml" }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`oulucomics.com -> HTTP ${res.status}`);
  const xml = await res.text();
  const items: Item[] = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => ({
    title: tag(m[1]!, "title"),
    description: tag(m[1]!, "description"),
    content: tag(m[1]!, "content:encoded"),
  }));

  // Today in Helsinki time, as YYYY-MM-DD.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki" }).format(new Date());
  let created = 0, duplicates = 0, ignored = 0;
  const unresolved = new Set<string>();
  for (const item of items) {
    const input = mapItem(item, today);
    if (input === "skip") { ignored++; continue; }
    if ("unresolved" in input) { unresolved.add(input.unresolved); continue; }
    if (await repo.findBySourceId(input.source, input.sourceId)) { duplicates++; continue; }
    await repo.create(input);
    created++;
  }

  await db
    .prepare(
      `INSERT INTO sync_state (key, last_run) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET last_run = excluded.last_run`,
    )
    .bind(SYNC_KEY, new Date().toISOString())
    .run();

  return { fetched: items.length, created, duplicates, ignored, unresolved: [...unresolved] };
}
