/**
 * Passkey (WebAuthn) admin login for events-service - the auth host.
 *
 * Flow:
 *   register/options + register/verify  -> store a credential (one-time, bootstrap
 *                                          authorized by the static ADMIN_TOKEN)
 *   login/options + login/verify        -> prove possession of the credential, after
 *                                          which index.ts mints a session token
 *
 * On Windows with no fingerprint reader this uses the Windows Hello PIN, backed by
 * the computer's TPM. The private key never leaves the device.
 */
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server";

export type RpConfig = { rpID: string; rpName: string; origin: string };

/** Relying-party config from env, with localhost dev defaults. */
export function rpConfig(env: { RP_ID?: string; RP_NAME?: string; RP_ORIGIN?: string }): RpConfig {
  return {
    rpID: env.RP_ID || "localhost",
    rpName: env.RP_NAME || "CosplayMap Admin",
    origin: env.RP_ORIGIN || "http://localhost:3000",
  };
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// ---------- hex <-> bytes (public keys are stored hex-encoded) ----------
// The library types want Uint8Array backed specifically by ArrayBuffer.
type Bytes = Uint8Array<ArrayBuffer>;
function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
function fromHex(hex: string): Bytes {
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// ---------- challenge store (single row) ----------
async function setChallenge(db: D1Database, challenge: string, purpose: "register" | "login") {
  await db
    .prepare(
      `INSERT INTO admin_challenge (id, challenge, purpose, expires) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET challenge = excluded.challenge, purpose = excluded.purpose, expires = excluded.expires`,
    )
    .bind(challenge, purpose, Date.now() + CHALLENGE_TTL_MS)
    .run();
}
async function takeChallenge(db: D1Database, purpose: "register" | "login"): Promise<string | null> {
  const row = (await db.prepare("SELECT challenge, purpose, expires FROM admin_challenge WHERE id = 1").first()) as
    | { challenge: string; purpose: string; expires: number }
    | null;
  await db.prepare("DELETE FROM admin_challenge WHERE id = 1").run(); // one-time use
  if (!row || row.purpose !== purpose || Number(row.expires) < Date.now()) return null;
  return String(row.challenge);
}

// ---------- credential store ----------
type StoredCred = { id: string; publicKey: Bytes; counter: number; transports?: AuthenticatorTransportFuture[] };

export async function adminCount(db: D1Database): Promise<number> {
  const row = (await db.prepare("SELECT COUNT(*) AS n FROM admin_credentials").first()) as { n: number } | null;
  return row ? Number(row.n) : 0;
}
async function listCredentials(db: D1Database): Promise<StoredCred[]> {
  const { results } = await db.prepare("SELECT id, public_key, counter, transports FROM admin_credentials").all();
  return (results as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    publicKey: fromHex(String(r.public_key)),
    counter: Number(r.counter),
    transports: r.transports ? (JSON.parse(String(r.transports)) as AuthenticatorTransportFuture[]) : undefined,
  }));
}
async function getCredential(db: D1Database, id: string): Promise<StoredCred | null> {
  const r = (await db
    .prepare("SELECT id, public_key, counter, transports FROM admin_credentials WHERE id = ?")
    .bind(id)
    .first()) as Record<string, unknown> | null;
  if (!r) return null;
  return {
    id: String(r.id),
    publicKey: fromHex(String(r.public_key)),
    counter: Number(r.counter),
    transports: r.transports ? (JSON.parse(String(r.transports)) as AuthenticatorTransportFuture[]) : undefined,
  };
}

// ---------- public operations used by index.ts routes ----------
export async function beginRegistration(env: { DB: D1Database } & Parameters<typeof rpConfig>[0], db: D1Database) {
  const { rpID, rpName } = rpConfig(env);
  const existing = await listCredentials(db);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: "admin",
    userDisplayName: "Admin",
    userID: new Uint8Array(new TextEncoder().encode("cosplaymap-admin")),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required", // forces the PIN / biometric
      authenticatorAttachment: "platform", // Windows Hello on this device
    },
  });
  await setChallenge(db, options.challenge, "register");
  return options;
}

export async function finishRegistration(
  env: Parameters<typeof rpConfig>[0],
  db: D1Database,
  response: RegistrationResponseJSON,
): Promise<boolean> {
  const { rpID, origin } = rpConfig(env);
  const expectedChallenge = await takeChallenge(db, "register");
  if (!expectedChallenge) return false;
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) return false;
  const { credential } = verification.registrationInfo;
  await db
    .prepare("INSERT OR REPLACE INTO admin_credentials (id, public_key, counter, transports) VALUES (?, ?, ?, ?)")
    .bind(credential.id, toHex(credential.publicKey), credential.counter, JSON.stringify(credential.transports ?? []))
    .run();
  return true;
}

export async function beginLogin(env: Parameters<typeof rpConfig>[0], db: D1Database) {
  const { rpID } = rpConfig(env);
  const creds = await listCredentials(db);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: creds.map((c) => ({ id: c.id, transports: c.transports })),
  });
  await setChallenge(db, options.challenge, "login");
  return options;
}

export async function finishLogin(
  env: Parameters<typeof rpConfig>[0],
  db: D1Database,
  response: AuthenticationResponseJSON,
): Promise<boolean> {
  const { rpID, origin } = rpConfig(env);
  const expectedChallenge = await takeChallenge(db, "login");
  if (!expectedChallenge) return false;
  const cred = await getCredential(db, response.id);
  if (!cred) return false;
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: { id: cred.id, publicKey: cred.publicKey, counter: cred.counter, transports: cred.transports },
  });
  if (!verification.verified) return false;
  await db
    .prepare("UPDATE admin_credentials SET counter = ? WHERE id = ?")
    .bind(verification.authenticationInfo.newCounter, cred.id)
    .run();
  return true;
}
