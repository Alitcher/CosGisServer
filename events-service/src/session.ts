/**
 * Tiny stateless admin session token: `payloadHex.sigHex`, signed with HMAC-SHA256.
 * Issued after a successful passkey (WebAuthn) login and accepted by `requireAdmin`
 * in place of the static ADMIN_TOKEN. Both services verify it with the same secret,
 * so a token minted by events-service also unlocks places-service.
 */
const enc = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Mint a signed session token valid for `ttlSeconds` (default 12h). */
export async function signSession(secret: string, ttlSeconds = 43200): Promise<string> {
  const payload = toHex(enc.encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  const sig = toHex(await hmac(secret, payload));
  return `${payload}.${sig}`;
}

/** True only if the signature is valid AND the token has not expired. */
export async function verifySession(secret: string, token: string): Promise<boolean> {
  if (!secret || !token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = toHex(await hmac(secret, payload));
  if (!timingSafeEqual(sig, expected)) return false;
  try {
    const decoded = JSON.parse(new TextDecoder().decode(fromHex(payload))) as { exp?: number };
    return typeof decoded.exp === "number" && decoded.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
