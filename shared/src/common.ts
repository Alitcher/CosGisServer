import { z } from 'zod';

/**
 * Countries covered by the map (ISO 3166-1 alpha-2): the Nordics, the Baltics,
 * and the autonomous regions Aland, Faroe Islands and Greenland.
 */
export const CountryEnum = z.enum(['FI', 'SE', 'NO', 'DK', 'IS', 'EE', 'LV', 'LT', 'AX', 'FO', 'GL']);
export type Country = z.infer<typeof CountryEnum>;

/**
 * City / town name. Free text now that the map covers several countries; the
 * client fills it from the address search. Older Finnish rows use ASCII
 * spellings (Jyvaskyla), newer ones may keep their accents (e.g. Malmo with an accent).
 */
export const CityName = z.string().trim().min(1).max(80);
export type City = z.infer<typeof CityName>;

/** Publish state shared by events and places. */
export const StatusEnum = z.enum(['live', 'draft', 'pending']);
export type Status = z.infer<typeof StatusEnum>;

/** ISO calendar date, e.g. "2026-07-11". */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date as YYYY-MM-DD');

/** Local (Europe/Helsinki) wall-clock time, 24h, e.g. "18:30". */
export const LocalTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected time as HH:MM');

/**
 * A web link that is safe to render as `href`. Plain `z.url()` also accepts
 * `javascript:` and `data:` URLs, which would run script when clicked.
 */
export const HttpUrl = z.url({ protocol: /^https?$/ });

/** Geographic coordinate bounds (WGS84). Stored as plain numbers — D1 has no PostGIS. */
export const Longitude = z.number().min(-180).max(180);
export const Latitude = z.number().min(-90).max(90);
