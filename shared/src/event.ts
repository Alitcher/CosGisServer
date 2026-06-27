import { z } from 'zod';
import { CityEnum, StatusEnum, IsoDate, Longitude, Latitude } from './common';

/** A dated anime convention plotted on the map. */
export const EventSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  venue: z.string().min(1).max(120),
  city: CityEnum,
  date: IsoDate,
  lng: Longitude,
  lat: Latitude,
  description: z.string().max(500).optional(),
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
