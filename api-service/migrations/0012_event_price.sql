-- Event entry price. admission: free | paid | mixed (free entry, paid extras);
-- price_min / price_max in EUR (one price = price_min only); price_note = free text.
-- All optional: NULL = not known.
ALTER TABLE events ADD COLUMN admission TEXT;
ALTER TABLE events ADD COLUMN price_min REAL;
ALTER TABLE events ADD COLUMN price_max REAL;
ALTER TABLE events ADD COLUMN price_note TEXT;
