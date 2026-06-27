# shared/ — Shared contracts (`@anime-con/shared`)

The source of truth for the data shapes, used by **all services in this repo** to
validate writes and describe responses. **Internal only** — the client lives in a
separate repo and keeps its own lightweight types (it's a read-only API consumer),
so this package is not published.

## What lives here
- The **`Event`** type and its **Zod schema** (validates incoming API bodies and
  describes outgoing responses).
- City enum (`Helsinki | Vantaa | Espoo`), status enum (`live | draft | pending`).
- GeoJSON helper types.

## Example shape (to implement)
```ts
// event.ts
import { z } from 'zod';

export const CityEnum = z.enum(['Helsinki', 'Vantaa', 'Espoo']);
export const StatusEnum = z.enum(['live', 'draft', 'pending']);

export const EventSchema = z.object({
  id:          z.string().uuid(),
  name:        z.string().min(1),
  venue:       z.string().min(1),
  city:        CityEnum,
  date:        z.string(),        // ISO date, e.g. "2026-07-11"
  lng:         z.number(),        // longitude
  lat:         z.number(),        // latitude
  description: z.string().optional(),
  status:      StatusEnum,
});

export type Event = z.infer<typeof EventSchema>;

// For create requests the server generates id/status:
export const NewEventSchema = EventSchema.omit({ id: true, status: true });
```

> ⚠️ **No PostGIS here** — D1 is SQLite. Geometry is stored as plain `lng`/`lat`
> columns and queried with bounding boxes (`WHERE lng BETWEEN ? AND ? ...`).
