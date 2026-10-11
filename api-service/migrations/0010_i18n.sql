-- Translated event/place text. `name` and `description` stay in the original
-- language (`lang`: en | fi | et | th, NULL = not known yet); `i18n` holds the
-- other languages as JSON, e.g. {"en":{"name":"...","description":"...","auto":true}}.
-- Filled by the server's auto-translation (services/translate.ts); an admin can
-- fix entries by hand (auto = false), which auto-translation then leaves alone.
-- (0009 is skipped on purpose: a removed 0009 migration is still recorded locally.)
ALTER TABLE events ADD COLUMN lang TEXT;
ALTER TABLE events ADD COLUMN i18n TEXT;
ALTER TABLE places ADD COLUMN lang TEXT;
ALTER TABLE places ADD COLUMN i18n TEXT;
