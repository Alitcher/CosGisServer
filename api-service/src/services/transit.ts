import type { Transit, TransitKind } from "@anime-con/shared";

/**
 * Nearby public transport for an event or place. Used by the admin "Look up"
 * button (POST /v1/admin/transit/lookup) and by scripts/fill-transit.ts.
 *
 * - Finland: Digitransit (HSL / national journey planner data, official, needs a
 *   free key in DIGITRANSIT_KEY). Falls back to OSM if it fails.
 * - Everywhere else (or without a key): OpenStreetMap through the free Overpass API.
 *
 * Returns the nearest named stop of each kind, nearest first. Rail stations are
 * searched further out than tram and bus stops, since people walk further to them.
 *
 * Only type imports here: the fill script runs this file directly with Node.
 */

/** Search radius per kind, in metres. */
export const TRANSIT_RADIUS: Record<TransitKind, number> = { metro: 800, train: 800, tram: 400, bus: 300 };

// Public Overpass servers. All are asked at once and the first good answer wins,
// so one slow or broken server does not hold up the lookup.
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

type OsmElement = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

function query(lat: number, lng: number): string {
  const rail = `around:${Math.max(TRANSIT_RADIUS.metro, TRANSIT_RADIUS.train)},${lat},${lng}`;
  const tram = `around:${TRANSIT_RADIUS.tram},${lat},${lng}`;
  const bus = `around:${TRANSIT_RADIUS.bus},${lat},${lng}`;
  return `[out:json][timeout:12];
(
  nwr(${rail})[railway~"^(station|halt)$"];
  nwr(${rail})[public_transport=station][station~"^(subway|train|light_rail)$"];
  node(${tram})[railway=tram_stop];
  node(${tram})[public_transport=platform][tram=yes];
  node(${bus})[highway=bus_stop];
);
out center tags;`;
}

/** Which kind of stop an OSM element is, or null if it isn't one we show. */
export function classify(tags: Record<string, string>): TransitKind | null {
  if (tags.station === "subway" || tags.subway === "yes") return "metro";
  if (tags.railway === "tram_stop" || tags.tram === "yes") return "tram";
  if (tags.railway === "station" || tags.railway === "halt" || tags.station === "train" || tags.station === "light_rail") {
    // A station tagged only for trams (e.g. some light rail) still counts as tram.
    return tags.train === "no" && tags.tram === "yes" ? "tram" : "train";
  }
  if (tags.highway === "bus_stop") return "bus";
  return null;
}

/** Great-circle distance in metres. */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

/** Nearest named stop per kind from raw Overpass elements, nearest first. */
export function pickNearest(elements: OsmElement[], lat: number, lng: number): Transit {
  const best = new Map<TransitKind, { name: string; distance: number }>();
  for (const el of elements) {
    const tags = el.tags ?? {};
    const kind = classify(tags);
    const name = (tags.name ?? "").trim();
    const p = el.center ?? (el.lat != null && el.lon != null ? { lat: el.lat, lon: el.lon } : null);
    if (!kind || !name || !p) continue;
    const distance = Math.round(distanceM(lat, lng, p.lat, p.lon) / 10) * 10; // to 10 m
    if (distance > TRANSIT_RADIUS[kind]) continue;
    const cur = best.get(kind);
    if (!cur || distance < cur.distance) best.set(kind, { name: name.slice(0, 80), distance });
  }
  return [...best].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => a.distance - b.distance);
}

/** Give up on the whole lookup after this long (ms). */
const TIMEOUT_MS = 15000;

/** Nearest metro / train / tram / bus stops from OpenStreetMap. Throws if OSM can't be reached in time. */
export async function lookupOsm(lat: number, lng: number): Promise<Transit> {
  const body = "data=" + encodeURIComponent(query(lat, lng));
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), TIMEOUT_MS);
  try {
    return await Promise.any(
      ENDPOINTS.map(async (url) => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "CosoraAtlas/1.0 (transit lookup)" },
          body,
          signal: stop.signal,
        });
        if (!res.ok) throw new Error(`Overpass ${res.status}`);
        const json = (await res.json()) as { elements?: OsmElement[] };
        return pickNearest(json.elements ?? [], lat, lng);
      }),
    );
  } catch {
    throw new Error(stop.signal.aborted ? "OpenStreetMap took too long" : "OpenStreetMap servers are not answering");
  } finally {
    clearTimeout(timer);
    stop.abort(); // cancel the slower servers' requests
  }
}

// ---------------- Digitransit (Finland) ----------------

const DIGITRANSIT_URL = "https://api.digitransit.fi/routing/v2/finland/gtfs/v1";
const DIGITRANSIT_MODE: Record<string, TransitKind> = { SUBWAY: "metro", RAIL: "train", TRAM: "tram", BUS: "bus" };

/** Rough boxes around Finland (with Aland) and Estonia, where the "finland" router has data. */
export function inFinland(lat: number, lng: number): boolean {
  const finland = lat >= 59.6 && lat <= 70.2 && lng >= 19.0 && lng <= 31.7;
  const estonia = lat >= 57.5 && lat < 59.9 && lng >= 21.7 && lng <= 28.3;
  return finland || estonia;
}

/** Nearest stops from Digitransit (HSL + the rest of Finland). Throws on errors or after TIMEOUT_MS. */
export async function lookupDigitransit(lat: number, lng: number, key: string): Promise<Transit> {
  const radius = Math.max(...Object.values(TRANSIT_RADIUS));
  const query = `{ stopsByRadius(lat: ${lat}, lon: ${lng}, radius: ${radius}, first: 200) {
    edges { node { distance stop { name vehicleMode } } } } }`;
  const res = await fetch(DIGITRANSIT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "digitransit-subscription-key": key },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Digitransit ${res.status}`);
  type Edge = { node: { distance: number; stop: { name?: string; vehicleMode?: string } | null } };
  const json = (await res.json()) as { data?: { stopsByRadius?: { edges?: Edge[] } }; errors?: unknown[] };
  if (json.errors?.length || !json.data) throw new Error("Digitransit query failed");

  const best = new Map<TransitKind, { name: string; distance: number }>();
  for (const { node } of json.data.stopsByRadius?.edges ?? []) {
    const kind = DIGITRANSIT_MODE[node.stop?.vehicleMode ?? ""];
    const name = (node.stop?.name ?? "").trim();
    const distance = Math.round(node.distance / 10) * 10;
    if (!kind || !name || distance > TRANSIT_RADIUS[kind]) continue;
    const cur = best.get(kind);
    if (!cur || distance < cur.distance) best.set(kind, { name: name.slice(0, 80), distance });
  }
  return [...best].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => a.distance - b.distance);
}

/**
 * Nearest stops around a point: Digitransit inside Finland (when a key is set),
 * OpenStreetMap otherwise or when Digitransit fails.
 */
export async function lookupTransit(lat: number, lng: number, opts: { digitransitKey?: string } = {}): Promise<Transit> {
  if (opts.digitransitKey && inFinland(lat, lng)) {
    try {
      return await lookupDigitransit(lat, lng, opts.digitransitKey);
    } catch (e) {
      console.error("digitransit lookup failed, trying OSM", e);
    }
  }
  return lookupOsm(lat, lng);
}
