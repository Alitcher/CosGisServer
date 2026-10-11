-- Nearby public transport for events and places, as JSON:
-- [{"kind":"metro","name":"Kamppi","distance":220}, ...] (kind: metro | train | tram | bus,
-- distance in metres). Set by an admin, by hand or from OpenStreetMap
-- (src/services/transit.ts, scripts/fill-transit.ts).
-- NULL = never checked; '[]' = checked, nothing close.
ALTER TABLE events ADD COLUMN transit TEXT;
ALTER TABLE places ADD COLUMN transit TEXT;
