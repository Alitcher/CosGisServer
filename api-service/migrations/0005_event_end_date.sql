-- Optional end date for multi-day events (a weekend con, etc.). NULL = single day.
ALTER TABLE events ADD COLUMN end_date TEXT;
