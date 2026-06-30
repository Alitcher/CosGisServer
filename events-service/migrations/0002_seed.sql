-- Sample live events so local dev shows data immediately.
INSERT OR IGNORE INTO events (id, name, venue, city, date, lng, lat, description, status) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Tracon Hel', 'Messukeskus', 'Helsinki', '2026-07-11', 24.9354, 60.2012, 'Anime, manga & cosplay weekend at the Helsinki Expo Centre.', 'live'),
  ('22222222-2222-4222-8222-222222222222', 'Yukicon Summer', 'Vantaa Energia Areena', 'Vantaa', '2026-08-23', 25.0116, 60.2931, 'Community-run con with artist alley, panels and concerts.', 'live'),
  ('33333333-3333-4333-8333-333333333333', 'Tsukicon Mini', 'Kaapelitehdas', 'Helsinki', '2026-09-14', 24.9043, 60.1640, 'One-day autumn meetup at the Cable Factory.', 'live'),
  ('44444444-4444-4444-8444-444444444444', 'Cosvision', 'Dipoli', 'Espoo', '2026-10-04', 24.8270, 60.1849, 'Cosplay-focused day with workshops and a masquerade.', 'live'),
  ('55555555-5555-4555-8555-555555555555', 'Hellocon', 'Messukeskus', 'Helsinki', '2026-11-15', 24.9354, 60.2012, 'Late-autumn pop-culture convention.', 'live'),
  ('66666666-6666-4666-8666-666666666666', 'Desucon Frostbite', 'Vantaa Energia Areena', 'Vantaa', '2026-12-06', 25.0116, 60.2931, 'Cosy winter edition of the beloved Desucon series.', 'live');
