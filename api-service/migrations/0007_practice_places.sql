-- Practice / rehearsal places for the Practice tab: dance studios (J-pop/K-pop
-- classes, room rental) and practice spaces (sports halls, youth centres) where
-- groups rehearse cover dances and cosplay performances. The two new place types
-- need no change here - `type` is plain TEXT, validated by Zod - so these columns
-- only hold the practice details. All optional; existing photo spots keep NULLs.
ALTER TABLE places ADD COLUMN booking TEXT;                          -- drop-in | booking-required | classes-only
ALTER TABLE places ADD COLUMN price TEXT;                            -- free | paid
ALTER TABLE places ADD COLUMN price_note TEXT;                       -- e.g. '15 €/h'
ALTER TABLE places ADD COLUMN facilities TEXT NOT NULL DEFAULT '[]'; -- JSON array: mirrors, sound-system, ...
ALTER TABLE places ADD COLUMN youth_friendly INTEGER;                -- 1/0, set by admins only; NULL = unknown
ALTER TABLE places ADD COLUMN booking_url TEXT;
