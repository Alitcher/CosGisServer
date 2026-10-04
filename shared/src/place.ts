import { z } from 'zod';
import { CityEnum, StatusEnum, HttpUrl, Longitude, Latitude } from './common';

/** Kind of cosplay-friendly place. Extensible. */
export const PlaceTypeEnum = z.enum([
  'cafe', 'restaurant', 'mall', 'studio', 'outdoor', // photo spots ('studio' = photo studio)
  'dance-studio', 'practice-space',                  // practice / rehearsal places
]);
export type PlaceType = z.infer<typeof PlaceTypeEnum>;

/**
 * Types shown on the Practice tab (places to rehearse cover dances and cosplay
 * performances) instead of the Spots tab (photo shoots).
 */
export const PRACTICE_TYPES = ['dance-studio', 'practice-space'] as const satisfies readonly PlaceType[];
export const isPracticeType = (t: PlaceType): boolean => (PRACTICE_TYPES as readonly string[]).includes(t);

/** What a place is for: `photo` = Spots tab, `practice` = Practice tab. */
export const PurposeEnum = z.enum(['photo', 'practice']);
export type Purpose = z.infer<typeof PurposeEnum>;

/** Place types that serve a purpose. */
export const typesFor = (purpose: Purpose): PlaceType[] =>
  PlaceTypeEnum.options.filter((t) => isPracticeType(t) === (purpose === 'practice'));

/** How you get in to practice: walk in, book a room, or only via classes. */
export const BookingEnum = z.enum(['drop-in', 'booking-required', 'classes-only']);
export const PriceEnum = z.enum(['free', 'paid']);
export const FacilityEnum = z.enum(['mirrors', 'sound-system', 'changing-room', 'big-floor']);

/** A photo of the place (URL-only for now; hosting deferred). */
export const PhotoSchema = z.object({
  url: z.url(),
  caption: z.string().max(160).optional(),
});
export type Photo = z.infer<typeof PhotoSchema>;

/** A cosplay-friendly location (cafe, restaurant, mall, studio, outdoor spot). */
export const PlaceSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  type: PlaceTypeEnum,
  city: CityEnum,
  address: z.string().max(200).optional(),
  lng: Longitude,
  lat: Latitude,
  /** Photo themes cosplayers can shoot here, e.g. ["maid cafe", "japanese garden"]. */
  themes: z.array(z.string().min(1).max(40)).default([]),
  photos: z.array(PhotoSchema).default([]),
  description: z.string().max(800).optional(),
  openingHours: z.string().max(200).optional(),
  // ---- practice places only (dance-studio / practice-space) ----
  booking: BookingEnum.optional(),
  price: PriceEnum.optional(),
  priceNote: z.string().max(120).optional(), // e.g. "15 €/h", "free for under 18s"
  // Optional rather than .default([]): a default would be filled in on partial
  // updates too, so a PUT without `facilities` would wipe the saved list.
  facilities: z.array(FacilityEnum).max(FacilityEnum.options.length).optional(),
  /** Under-18s may use it. Set by an admin from the venue's own rules, never by submitters. */
  youthFriendly: z.boolean().optional(),
  bookingUrl: HttpUrl.max(500).optional(),
  status: StatusEnum.default('draft'),
  createdAt: z.string().optional(),
});
export type Place = z.infer<typeof PlaceSchema>;

/** Payload to create a place — server assigns id/status/createdAt. */
export const NewPlaceSchema = PlaceSchema.omit({ id: true, status: true, createdAt: true });
export type NewPlace = z.infer<typeof NewPlaceSchema>;

/** Payload to update a place — every field optional. */
export const UpdatePlaceSchema = NewPlaceSchema.partial();
export type UpdatePlace = z.infer<typeof UpdatePlaceSchema>;

/** Community-submitted place (lands in the pending queue). `youthFriendly` is admin-only. */
export const PlaceSubmissionSchema = NewPlaceSchema.omit({ youthFriendly: true }).extend({
  submittedBy: z.string().min(1).max(60).optional(),
});
export type PlaceSubmission = z.infer<typeof PlaceSubmissionSchema>;
