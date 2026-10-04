-- Optional thumbnail / logo for an event (an image URL). NULL = no picture; the
-- client falls back to a placeholder icon.
ALTER TABLE events ADD COLUMN image TEXT;
-- Optional local (Europe/Helsinki) start/end times as 'HH:MM'. They sit beside
-- the existing date/end_date columns rather than replacing them, so rows and
-- clients that only know dates keep working. NULL = time not given.
ALTER TABLE events ADD COLUMN start_time TEXT;
ALTER TABLE events ADD COLUMN end_time TEXT;
