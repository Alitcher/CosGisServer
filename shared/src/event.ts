import { z } from 'zod';
import { CityName, CountryEnum, StatusEnum, IsoDate, LocalTime, Longitude, Latitude } from './common';

/** A dated anime convention plotted on the map. */
export const EventSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  venue: z.string().min(1).max(120),
  city: CityName,
  // Optional with no .default(): a default would also fill in on partial updates.
  // Missing on create = 'FI' (repo + DB default); always set on output.
  country: CountryEnum.optional(),
  date: IsoDate,           // start date (single-day events use only this)
  endDate: IsoDate.optional(), // last day, for multi-day events (>= date)
  lng: Longitude,
  lat: Latitude,
  description: z.string().max(500).optional(),
  url: z.url().max(500).optional(),   // organizer / event-info page (e.g. Linked Events info_url)
  image: z.url().max(500).optional(), // thumbnail / logo shown on cards and map popups
  startTime: LocalTime.optional(),    // doors open on `date`
  endTime: LocalTime.optional(),      // closing time on `endDate` (or `date` if single-day)
  status: StatusEnum.default('draft'),
  createdAt: z.string().optional(),
});
export type Event = z.infer<typeof EventSchema>;

/** Payload to create an event — server assigns id/status/createdAt. */
export const NewEventSchema = EventSchema.omit({ id: true, status: true, createdAt: true });
export type NewEvent = z.infer<typeof NewEventSchema>;

/** Payload to update an event — every field optional. */
export const UpdateEventSchema = NewEventSchema.partial();
export type UpdateEvent = z.infer<typeof UpdateEventSchema>;

/** Community-submitted event (lands in the pending queue). */
export const EventSubmissionSchema = NewEventSchema.extend({
  submittedBy: z.string().min(1).max(60).optional(),
});
export type EventSubmission = z.infer<typeof EventSubmissionSchema>;
