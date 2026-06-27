import { z } from 'zod';
import { CityEnum, StatusEnum, Longitude, Latitude } from './common';

/** Kind of cosplay-friendly place. Extensible. */
export const PlaceTypeEnum = z.enum(['cafe', 'restaurant', 'mall', 'studio', 'outdoor']);
export type PlaceType = z.infer<typeof PlaceTypeEnum>;

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

/** Community-submitted place (lands in the pending queue). */
export const PlaceSubmissionSchema = NewPlaceSchema.extend({
  submittedBy: z.string().min(1).max(60).optional(),
});
export type PlaceSubmission = z.infer<typeof PlaceSubmissionSchema>;
