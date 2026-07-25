'use client';

/**
 * Where the browser keeps the ephemeral signing key.
 *
 * WHY localStorage AND NOT sessionStorage
 * ---------------------------------------
 * `sessionStorage` is scoped to a tab: close it, and the key is gone. That made a "48 hour session"
 * impossible to deliver — the server cookie would happily last two days while the key it depends on
 * died the moment the tab did. The user would come back to a page that said "signed in" and then watch
 * every send fail with "No zkLogin session", which reads as a broken wallet rather than an expired login.
 *
 * WHAT THIS MEANS FOR SAFETY
 * --------------------------
 * The ephemeral key is a real signing credential, so persisting it is a genuine trade — it is now
 * readable by anything with access to this origin's storage on this machine, for up to 48 hours, rather
 * than until the tab closes. Three things bound the exposure:
 *
 *   • it is *ephemeral by construction*: the ZK proof binds it to `maxEpoch`, so the chain itself stops
 *     honouring it after ~2 Sui epochs no matter what is stored where,
 *   • it is useless alone — a transaction also needs the Groth16 proof, which requires the JWT and salt
 *     that live only in the httpOnly server cookie and are never exposed to JavaScript,
 *   • it is deleted the instant it expires, on sign-out, and whenever it fails to parse.
 *
 * So a stolen key without the session cookie cannot sign anything, and it self-destructs on a deadline.
 * That is the standard zkLogin arrangement for sessions that outlive a tab.
 */

import type { EphemeralSession } from '@/lib/zklogin/zklogin';
import { hasExpired } from '@/lib/zklogin/duration';

/** Bumped when the stored shape changes, so an old entry is ignored rather than half-read. */
export const EPH_KEY = 'zk.ephemeral.v2';

/** The pre-48h key, cleared on sight so it cannot linger in storage. */
const LEGACY_KEYS = ['zk.ephemeral'];

/** Persist the ephemeral session for the life of the login. */
export function saveEphemeral(session: EphemeralSession): void {
  try {
    window.localStorage.setItem(EPH_KEY, JSON.stringify(session));
  } catch {
    // Private mode or a full quota: the session still works for this tab, it just won't survive a close.
  }
}

/**
 * Read the ephemeral session, or null.
 *
 * Anything expired or unreadable is deleted rather than returned, so a stale key can never be used to
 * build a transaction that would be rejected on chain anyway.
 */
export function loadEphemeral(): EphemeralSession | null {
  if (typeof window === 'undefined') return null;
  try {
    for (const legacy of LEGACY_KEYS) {
      window.sessionStorage.removeItem(legacy);
      window.localStorage.removeItem(legacy);
    }
    const raw = window.localStorage.getItem(EPH_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as EphemeralSession;
    if (!session?.secretKey || hasExpired(session.expiresAt)) {
      clearEphemeral();
      return null;
    }
    return session;
  } catch {
    clearEphemeral();
    return null;
  }
}

/** Remove the key. Called on sign-out and on expiry. */
export function clearEphemeral(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(EPH_KEY);
    for (const legacy of LEGACY_KEYS) {
      window.sessionStorage.removeItem(legacy);
      window.localStorage.removeItem(legacy);
    }
  } catch {
    /* storage unavailable */
  }
}
