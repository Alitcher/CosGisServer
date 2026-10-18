-- Local community meetups (cosplay cafe, library workshop) next to conventions.
-- kind: convention | community (NULL = convention).
-- recurrence (community only), as JSON: {"freq":"weekly|biweekly|monthly|custom",
--   "nth":1..4 or -1 (monthly), "dates":["YYYY-MM-DD",...] (custom), "until":"YYYY-MM-DD", "note":"..."}
-- The weekday is the one of `date` (the first meeting). NULL = does not repeat.
ALTER TABLE events ADD COLUMN kind TEXT;
ALTER TABLE events ADD COLUMN recurrence TEXT;
