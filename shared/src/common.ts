import { z } from 'zod';

/** Cities covered by the map. Extend as the project grows. */
export const CityEnum = z.enum(['Helsinki', 'Vantaa', 'Espoo']);
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
