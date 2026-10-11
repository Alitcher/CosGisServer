import type { Event, Place } from "@anime-con/shared";
import { distanceM } from "./transit";

/**
 * Duplicate checks for public submissions, against everything already stored
 * (live, pending and draft). A duplicate submission is refused with 409.
 *
 * - Event: same link on the same start date. Several events can share a venue,
 *   and a recurring event (e.g. a monthly manga club) shares its link across
 *   dates, so neither the place nor the link alone is enough.
 * - Spot: same address, within 50 m, same name, same link or same photo.
 */

/** Spots closer than this (metres) count as the same place. */
export const SAME_PLACE_M = 50;

/** Text compared without case, extra spaces or punctuation: "Cafe  Sakura," == "cafe sakura". */
const normText = (s?: string) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Links compared without scheme, "www.", trailing slash or case. */
export function normUrl(u?: string): string {
  return (u ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

export function findDuplicateEvent(existing: Event[], input: { url?: string; date: string }): Event | null {
  const url = normUrl(input.url);
  if (!url) return null;
  return existing.find((e) => e.date === input.date && normUrl(e.url) === url) ?? null;
}

export function findDuplicatePlace(
  existing: Place[],
  input: { name: string; address?: string; lat: number; lng: number; bookingUrl?: string; photos?: { url: string }[] },
): Place | null {
  const name = normText(input.name);
  const address = normText(input.address);
  const link = normUrl(input.bookingUrl);
  const photos = new Set((input.photos ?? []).map((p) => normUrl(p.url)).filter(Boolean));
  return (
    existing.find(
      (p) =>
        (name && normText(p.name) === name) ||
        (address && normText(p.address) === address) ||
        distanceM(input.lat, input.lng, p.lat, p.lng) <= SAME_PLACE_M ||
        (link && normUrl(p.bookingUrl) === link) ||
        p.photos.some((ph) => photos.has(normUrl(ph.url))),
    ) ?? null
  );
}

/** 409 body: what it clashed with, so the form can say so. */
export const duplicateBody = (kind: "event" | "spot", hit: { id: string; name: string; status: string }) => ({
  error: "duplicate",
  message: `This ${kind} is already on the map or waiting for review.`,
  duplicateOf: { id: hit.id, name: hit.name, status: hit.status },
});
