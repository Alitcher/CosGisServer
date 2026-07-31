/**
 * Runtime bindings for the merged API service (events + places + admin auth).
 *
 * One Worker, one D1 database. What used to be split across events-service and
 * places-service now shares a single set of bindings, so the passkey secret and
 * CORS policy are configured in exactly one place.
 */
export type Bindings = {
  DB: D1Database;
  ADMIN_TOKEN: string;
  ALLOWED_ORIGINS?: string; // comma-separated site origins; empty = allow any (dev)
  SESSION_SECRET?: string;  // HMAC secret for passkey session tokens; falls back to ADMIN_TOKEN
  RP_ID?: string;           // WebAuthn relying-party id (domain), default "localhost"
  RP_NAME?: string;         // user-visible name, default "CosplayMap Admin"
  RP_ORIGIN?: string;       // expected site origin, default "http://localhost:3000"
};
