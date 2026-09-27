/**
 * Session management — cookie creation, signing, verification, and password hashing.
 *
 * Uses HMAC-SHA256 for stateless signed session tokens and scrypt for password
 * hashing. Zero external dependencies — only `node:crypto`.
 * @module
 */

import crypto from 'node:crypto';

export interface SessionPayload {
  /** Expiry timestamp (ms since epoch) */
  exp: number;
  /** Issued-at timestamp (ms since epoch) */
  iat: number;
  /**
   * Profile this session is BOUND to. Issued server-side at activation and
   * signed, so a client cannot widen its own access by editing a header or
   * cookie. Absent on a session that has never activated a profile.
   */
  pid?: string;
  /** Identifies this login session, so one side of a handshake can't be both. */
  sid?: string;
}

/** Module augmentation so `c.get('sessionPayload')` is typed across the app. */
declare module 'hono' {
  interface ContextVariableMap {
    sessionPayload?: SessionPayload;
  }
}

export interface CreateSessionOptions {
  profileId?: string;
  sessionId?: string;
}

/**
 * Create a signed session token.
 * Format: base64url(JSON payload).base64url(HMAC-SHA256 signature)
 */
export function createSession(secret: string, ttlMs: number, opts: CreateSessionOptions = {}): string {
  const payload: SessionPayload = {
    exp: Date.now() + ttlMs,
    iat: Date.now(),
  };
  if (opts.profileId) payload.pid = opts.profileId;
  if (opts.sessionId) payload.sid = opts.sessionId;
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

/**
 * Re-sign an EXISTING valid session bound to a profile. The new token keeps the
 * original `iat` and `sid`, so re-binding a profile does not launder the
 * session identity that bridge/approval checks rely on.
 * Returns null when the incoming token is invalid or expired.
 */
export function reissueSessionForProfile(
  token: string,
  secret: string,
  profileId: string,
): string | null {
  const existing = verifySession(token, secret);
  if (!existing) return null;
  const payload: SessionPayload = {
    exp: existing.exp,
    iat: existing.iat,
    pid: profileId,
    ...(existing.sid ? { sid: existing.sid } : {}),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a signed session token.
 * Returns the payload if valid and not expired, null otherwise.
 */
export function verifySession(token: string, secret: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');

  // Timing-safe comparison to prevent timing attacks
  if (sig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as SessionPayload;
    if (payload.exp < Date.now()) return null; // Expired
    return payload;
  } catch {
    return null;
  }
}

/**
 * Verify a password against a stored scrypt hash.
 * Hash format: salt:derivedKey (both hex-encoded)
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [saltHex, keyHex] = hash.split(':');
  if (!saltHex || !keyHex) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const storedKey = Buffer.from(keyHex, 'hex');

  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(crypto.timingSafeEqual(derivedKey, storedKey));
    });
  });
}

/**
 * Hash a password using scrypt.
 * Returns: salt:derivedKey (both hex-encoded)
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(32);
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt.toString('hex')}:${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * Parse the nerve_session cookie from a raw Cookie header string.
 * Used for WebSocket upgrade requests (outside Hono's middleware).
 */
export function parseSessionCookie(cookieHeader: string | undefined, cookieName: string): string | null {
  if (!cookieHeader) return null;
  const regex = new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`);
  const match = cookieHeader.match(regex);
  return match ? decodeURIComponent(match[1]) : null;
}
