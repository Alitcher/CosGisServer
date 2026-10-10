-- Nordic + Baltic coverage: every event and place gets a country (ISO 3166-1
-- alpha-2, validated by Zod: FI SE NO DK IS EE LV LT AX FO GL). City stays
-- plain TEXT but is now free text instead of a fixed Finnish list. Everything
-- already stored is in Finland, hence the default.
ALTER TABLE events ADD COLUMN country TEXT NOT NULL DEFAULT 'FI';
ALTER TABLE places ADD COLUMN country TEXT NOT NULL DEFAULT 'FI';
CREATE INDEX IF NOT EXISTS idx_events_country ON events(country);
CREATE INDEX IF NOT EXISTS idx_places_country ON places(country);
