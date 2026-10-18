-- Suggested ages for events and places, in whole years, e.g. 7-17 for a kids'
-- cosplay workshop. Only age_min = "7+", only age_max = "up to 12".
-- NULL = not known (no label shown).
ALTER TABLE events ADD COLUMN age_min INTEGER;
ALTER TABLE events ADD COLUMN age_max INTEGER;
ALTER TABLE places ADD COLUMN age_min INTEGER;
ALTER TABLE places ADD COLUMN age_max INTEGER;
