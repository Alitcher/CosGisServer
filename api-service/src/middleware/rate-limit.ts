import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../types";

/**
 * Daily quota for the public submission routes (events + places).
 *
 * The client is expected to send a stable `X-Device-Id` (a UUID it generates
 * once and keeps in local storage). That header is the primary bucket: 5
 * submissions per device per day. Because a header is trivially edited, the
 * caller's IP is counted too, with a looser cap - so clearing local storage or
 * rotating the id does not hand out an unlimited supply of slots.
 *
 * Requests with no device id fall back to the IP bucket at the *device* limit,
 * so a client that ignores the header is not rewarded with the bigger cap.
 *
 * Quota is consumed only when the submission is actually accepted (2xx), so a
 * validation error (400) does not cost the user one of their five.
 */

const DEFAULT_DEVICE_LIMIT = 5;
const DEFAULT_IP_LIMIT = 20;

/** Quotas reset at local midnight rather than 00:00 UTC - this is a Finnish app. */
const ZONE = "Europe/Helsinki";

type Bucket = { key: string; limit: number };

/** Local calendar day as 'YYYY-MM-DD' ('en-CA' formats dates in exactly that order). */
function localDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

/** Seconds until the next local midnight - the `Retry-After` hint. */
function secondsUntilReset(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return 86400 - (part("hour") * 3600 + part("minute") * 60 + part("second"));
}

/** Positive integer env var, or the fallback when unset/garbage. */
function limitFrom(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Who to count this request against. A device id gets its own bucket plus the
 * shared IP bucket; an anonymous caller only has the IP one. `unknown` keeps
 * the middleware safe if the platform header is missing (local dev): everyone
 * shares a bucket, which fails closed rather than open.
 */
function bucketsFor(deviceId: string, ip: string, deviceLimit: number, ipLimit: number): Bucket[] {
  if (!deviceId) return [{ key: `ip:${ip}`, limit: deviceLimit }];
  return [
    { key: `dev:${deviceId}`, limit: deviceLimit },
    { key: `ip:${ip}`, limit: ipLimit },
  ];
}

export const submissionQuota: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const deviceLimit = limitFrom(c.env.SUBMISSIONS_PER_DEVICE_PER_DAY, DEFAULT_DEVICE_LIMIT);
  const ipLimit = limitFrom(c.env.SUBMISSIONS_PER_IP_PER_DAY, DEFAULT_IP_LIMIT);

  // Cap the header length so a hostile client cannot write huge rows.
  const deviceId = (c.req.header("X-Device-Id") ?? "").trim().slice(0, 64);
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const buckets = bucketsFor(deviceId, ip, deviceLimit, ipLimit);

  const now = new Date();
  const day = localDay(now);

  const placeholders = buckets.map(() => "?").join(", ");
  const { results } = await c.env.DB.prepare(
    `SELECT bucket, count FROM submission_quota WHERE day = ? AND bucket IN (${placeholders})`,
  )
    .bind(day, ...buckets.map((b) => b.key))
    .all<{ bucket: string; count: number }>();

  const used = new Map(results.map((r) => [r.bucket, r.count]));
  const exceeded = buckets.find((b) => (used.get(b.key) ?? 0) >= b.limit);
  if (exceeded) {
    const retryAfter = secondsUntilReset(now);
    return c.json(
      {
        error: "Daily submission limit reached",
        limit: exceeded.limit,
        retryAfter,
      },
      429,
      { "Retry-After": String(retryAfter) },
    );
  }

  await next();

  // Only an accepted submission spends a slot.
  if (c.res.status >= 200 && c.res.status < 300) {
    await c.env.DB.batch(
      buckets.map((b) =>
        c.env.DB.prepare(
          `INSERT INTO submission_quota (bucket, day, count) VALUES (?, ?, 1)
           ON CONFLICT(bucket, day) DO UPDATE SET count = count + 1`,
        ).bind(b.key, day),
      ),
    );
  }
};

/** Housekeeping for the daily cron: yesterday's counters are dead weight. */
export async function purgeOldQuota(db: D1Database, now: Date = new Date()): Promise<void> {
  await db.prepare("DELETE FROM submission_quota WHERE day < ?").bind(localDay(now)).run();
}
