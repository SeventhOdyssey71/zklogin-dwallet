/**
 * Tiny encrypted session — AES-256-GCM over a JSON payload, keyed by
 * SESSION_SECRET. Good enough for an httpOnly cookie holding the zkLogin
 * session (JWT + salt + address). In production you may prefer `iron-session`
 * or a server-side store keyed by an opaque session id; the shape is the same.
 *
 * NOTE the JWT is sensitive (it's a bearer credential until it expires) — keep
 * the cookie httpOnly + Secure, and never expose the salt or JWT to the client.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { SESSION_DURATION_MS } from "./duration";

export interface ZkSession {
  jwt: string;
  salt: string;
  address: string;
  email?: string;
  name?: string;
  /** Epoch ms after which this session is refused. Sealed in, so it cannot be edited client-side. */
  expiresAt: number;
}

export const SESSION_COOKIE = "zk_session";

function key(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set (any random 32+ char string)");
  return createHash("sha256").update(s).digest(); // 32 bytes
}

/** Seal a session into a compact base64url token for the cookie value. */
export function sealSession(session: ZkSession): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const pt = Buffer.from(JSON.stringify(session), "utf8");
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64url");
}

/** A session sealed now, expiring after the standard duration. */
export function newSession(fields: Omit<ZkSession, "expiresAt">): ZkSession {
  return { ...fields, expiresAt: Date.now() + SESSION_DURATION_MS };
}

/**
 * Open a sealed cookie value back into a session — or null if invalid, tampered with, or expired.
 *
 * Expiry is enforced HERE rather than relying on the cookie's `maxAge`. `maxAge` is a request to the
 * browser: it governs when the browser stops sending the cookie, not whether the server accepts it. A
 * client that keeps presenting an old cookie would otherwise stay signed in indefinitely. Because
 * `expiresAt` sits inside the AES-GCM sealed payload, it cannot be altered without invalidating the
 * whole token.
 */
export function openSession(token: string | undefined | null): ZkSession | null {
  if (!token) return null;
  try {
    const buf = Buffer.from(token, "base64url");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    const session = JSON.parse(pt.toString("utf8")) as ZkSession;
    // A session sealed before `expiresAt` existed has no business surviving a deploy either.
    if (!session.expiresAt || Date.now() >= session.expiresAt) return null;
    return session;
  } catch {
    return null;
  }
}
