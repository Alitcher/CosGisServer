-- Sample live places so local dev shows data immediately.
INSERT OR IGNORE INTO places
  (id, name, type, city, address, lng, lat, themes, photos, description, opening_hours, status)
VALUES
  ('a1111111-1111-4111-8111-111111111111', 'Café Sakura', 'cafe', 'Helsinki', 'Iso Roobertinkatu 12, Helsinki', 24.9402, 60.1641,
   '["pastel","japanese garden","kawaii"]',
   '[{"url":"https://picsum.photos/seed/sakura/600/400","caption":"Pastel interior"}]',
   'Cosy pastel café that happily welcomes cosplayers for photos.', '10:00-20:00', 'live'),
  ('a2222222-2222-4222-8222-222222222222', 'Neon Ramen Bar', 'restaurant', 'Helsinki', 'Kaisaniemenkatu 4, Helsinki', 24.9465, 60.1718,
   '["cyberpunk","neon","night city"]',
   '[{"url":"https://picsum.photos/seed/ramen/600/400","caption":"Neon counter"}]',
   'Neon-lit ramen spot with a cyberpunk vibe — great for night shoots.', '16:00-23:00', 'live'),
  ('a3333333-3333-4333-8333-333333333333', 'Studio Hikari', 'studio', 'Vantaa', 'Tikkurila, Vantaa', 25.0432, 60.2925,
   '["chroma key","fantasy sets","studio lighting"]',
   '[{"url":"https://picsum.photos/seed/hikari/600/400","caption":"Studio set"}]',
   'Bookable photo studio with cosplay-friendly sets and lighting.', 'By appointment', 'live');
