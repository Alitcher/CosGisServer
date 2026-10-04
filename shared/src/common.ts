import { z } from 'zod';

/**
 * Cities covered by the map. Extend as the project grows.
 *
 * Widened past the capital region when the conit.fi import landed: Finnish cons
 * are overwhelmingly held in Tampere, Lahti and Turku, so a capital-only enum
 * rejected almost the entire feed. Names are ASCII (Jyvaskyla, not the accented
 * form) to match the rest of the codebase.
 */
export const CityEnum = z.enum([
  'Helsinki', 'Vantaa', 'Espoo',
  'Tampere', 'Turku', 'Lahti', 'Oulu', 'Jyvaskyla', 'Kuopio',
]);
export type City = z.infer<typeof CityEnum>;

/** Publish state shared by events and places. */
export const StatusEnum = z.enum(['live', 'draft', 'pending']);
export type Status = z.infer<typeof StatusEnum>;

/** ISO calendar date, e.g. "2026-07-11". */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date as YYYY-MM-DD');

/** Geographic coordinate bounds (WGS84). Stored as plain numbers — D1 has no PostGIS. */
export const Longitude = z.number().min(-180).max(180);
export const Latitude = z.number().min(-90).max(90);
