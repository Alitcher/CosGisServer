import type { Event } from './event';
import type { Place } from './place';

/** A GeoJSON Point feature carrying arbitrary properties P. */
export interface Feature<P> {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: P;
}

export interface FeatureCollection<P> {
  type: 'FeatureCollection';
  features: Feature<P>[];
}

export type EventProperties = Omit<Event, 'lng' | 'lat'>;
export type PlaceProperties = Omit<Place, 'lng' | 'lat'>;

export function eventToFeature(event: Event): Feature<EventProperties> {
  const { lng, lat, ...properties } = event;
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties };
}

export function eventsToFeatureCollection(events: Event[]): FeatureCollection<EventProperties> {
  return { type: 'FeatureCollection', features: events.map(eventToFeature) };
}

export function placeToFeature(place: Place): Feature<PlaceProperties> {
  const { lng, lat, ...properties } = place;
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties };
}

export function placesToFeatureCollection(places: Place[]): FeatureCollection<PlaceProperties> {
  return { type: 'FeatureCollection', features: places.map(placeToFeature) };
}
