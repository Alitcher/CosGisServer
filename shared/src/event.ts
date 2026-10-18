import { z } from 'zod';
import { CityName, CountryEnum, LangEnum, I18nSchema, StatusEnum, IsoDate, LocalTime, Longitude, Latitude, TransitSchema, AdmissionEnum, PriceEur, AgeYear, AgeYears } from './common';

/** A dated anime convention plotted on the map. */
export const EventSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  venue: z.string().min(1).max(120),
  city: CityName,
  // Optional with no .default(): a default would also fill in on partial updates.
  // Missing on create = 'FI' (repo + DB default); always set on output.
  country: CountryEnum.optional(),
  /** Language of name/description. Missing = unknown (guessed when translating). */
  lang: LangEnum.optional(),
  /** name/description in the other languages, see I18nSchema. */
  i18n: I18nSchema.optional(),
  date: IsoDate,           // start date (single-day events use only this)
  endDate: IsoDate.optional(), // last day, for multi-day events (>= date)
  lng: Longitude,
  lat: Latitude,
  description: z.string().max(500).optional(),
  url: z.url().max(500).optional(),   // organizer / event-info page (e.g. Linked Events info_url)
  image: z.url().max(500).optional(), // thumbnail / logo shown on cards and map popups
  /** Entry: free, paid, or free entry with paid extras. Missing = not known. */
  admission: AdmissionEnum.optional(),
  /** Cheapest / dearest ticket in EUR. One price = only priceMin (or both the same). */
  priceMin: PriceEur.optional(),
  priceMax: PriceEur.optional(),
  priceNote: z.string().max(160).optional(), // e.g. "Day ticket 15, weekend 25, under 7 free"
  /** Suggested ages, e.g. 7-17 for a kids' workshop. Only one = "7+" / "up to 12". */
  ageMin: AgeYears.optional(),
  ageMax: AgeYears.optional(),
  /** Nearby metro/train/tram/bus stops. Admin-only, see TransitSchema. */
  transit: TransitSchema.optional(),
  startTime: LocalTime.optional(),    // doors open on `date`
  endTime: LocalTime.optional(),      // closing time on `endDate` (or `date` if single-day)
  status: StatusEnum.default('draft'),
  createdAt: z.string().optional(),
});
export type Event = z.infer<typeof EventSchema>;

/** Payload to create an event - server assigns id/status/createdAt. */
export const NewEventSchema = EventSchema.omit({ id: true, status: true, createdAt: true });
export type NewEvent = z.infer<typeof NewEventSchema>;

/** Payload to update an event - every field optional. */
export const UpdateEventSchema = NewEventSchema.partial();
export type UpdateEvent = z.infer<typeof UpdateEventSchema>;

/** Community-submitted event (lands in the pending queue). `transit` is admin-only; the youngest suggested age is required. */
export const EventSubmissionSchema = NewEventSchema.omit({ transit: true }).extend({
  ageMin: AgeYear,
  submittedBy: z.string().min(1).max(60).optional(),
});
export type EventSubmission = z.infer<typeof EventSubmissionSchema>;
