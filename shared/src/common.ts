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

/** UI languages, which are also the languages event/place text is translated into. */
export const LangEnum = z.enum(['en', 'fi', 'et', 'th']);
export type Lang = z.infer<typeof LangEnum>;

/**
 * Translated name/description per language. The item's own `name`/`description`
 * stay in its original language (`lang`). `auto: false` marks a translation an
 * admin wrote or fixed by hand; auto-translation never overwrites those.
 */
export const TranslationSchema = z.object({
  name: z.string().max(120).optional(),
  description: z.string().max(800).optional(),
  auto: z.boolean().optional(),
});
export const I18nSchema = z.partialRecord(LangEnum, TranslationSchema);
export type I18n = z.infer<typeof I18nSchema>;

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

/** Geographic coordinate bounds (WGS84). Stored as plain numbers - D1 has no PostGIS. */
export const Longitude = z.number().min(-180).max(180);
export const Latitude = z.number().min(-90).max(90);

/**
 * Event entry: free, paid, or free entry with paid extras (workshops, signings...).
 */
export const AdmissionEnum = z.enum(['free', 'paid', 'mixed']);
export type Admission = z.infer<typeof AdmissionEnum>;

/** A price in euros (whole or cents), e.g. 15 or 12.5. */
export const PriceEur = z.number().min(0).max(10000);

/**
 * Suggested age in whole years (ageMin / ageMax on events and places), e.g. a kids'
 * workshop for 7-17. null on an update clears it; missing = not known.
 */
export const AgeYear = z.number().int().min(0).max(99);
export const AgeYears = AgeYear.nullable();

/**
 * convention = a dated event (cons, contests, one-off meetups).
 * community = a local get-together that repeats (cosplay cafe, library workshop): see RecurrenceSchema.
 */
export const EventKindEnum = z.enum(['convention', 'community']);
export type EventKind = z.infer<typeof EventKindEnum>;

/**
 * How a community meetup repeats. The weekday comes from the event's `date` (the first meeting).
 * weekly / biweekly = every 1 / 2 weeks; monthly = the `nth` weekday of each month (-1 = last);
 * custom = only on the listed `dates` (plus `date`). `until` = last possible day (missing = no end).
 */
export const RecurrenceSchema = z.object({
  freq: z.enum(['weekly', 'biweekly', 'monthly', 'custom']),
  nth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]).optional(),
  dates: z.array(IsoDate).max(60).optional(),
  until: IsoDate.optional(),
  note: z.string().max(160).optional(), // e.g. "Check Instagram for the exact day"
  /**
   * Groups on each meeting day, e.g. two library groups 14:30-15:30 and 15:30-16:30, or
   * one group elsewhere (`venue`). Missing = one group at the event's own times and venue.
   */
  slots: z.array(z.object({ start: LocalTime, end: LocalTime.optional(), venue: z.string().max(120).optional() })).max(10).optional(),
});
export type Recurrence = z.infer<typeof RecurrenceSchema>;

/** An age range must not run backwards ("from 17 to 7"). */
export const ageRangeOk = (e: { ageMin?: number | null; ageMax?: number | null }) =>
  e.ageMin == null || e.ageMax == null || e.ageMax >= e.ageMin;

/** Kinds of public transport stop shown next to an event or place. */
export const TransitKindEnum = z.enum(['metro', 'train', 'tram', 'bus']);
export type TransitKind = z.infer<typeof TransitKindEnum>;

/** One nearby stop: what it is, its name, and the straight-line distance in metres. */
export const TransitStopSchema = z.object({
  kind: TransitKindEnum,
  name: z.string().trim().min(1).max(80),
  distance: z.number().int().min(0).max(5000),
});
export type TransitStop = z.infer<typeof TransitStopSchema>;

/**
 * Nearby public transport, set by an admin: typed by hand or filled from
 * OpenStreetMap (services/transit.ts). Missing = never checked; [] = checked,
 * nothing close.
 */
export const TransitSchema = z.array(TransitStopSchema).max(8);
export type Transit = z.infer<typeof TransitSchema>;
