/**
 * How long a signed-in session lasts.
 *
 * A zkLogin session has THREE independent expiries, and before this they disagreed:
 *
 *   1. the ephemeral key's `maxEpoch` — the ZK proof is only valid through that Sui epoch,
 *   2. the server session cookie,
 *   3. the browser's copy of the ephemeral private key.
 *
 * The shortest one wins, and the old values were badly mismatched: the cookie said 24h, `maxEpoch`
 * covered 48–72h, and the key itself sat in `sessionStorage`, so it vanished the moment the tab closed.
 * A user could return to a page that said "signed in", then have every send fail with "No zkLogin
 * session" — the cookie outliving the key it depends on.
 *
 * Everything now derives from `SESSION_DURATION_MS`, so the three cannot drift apart again.
 */

/** 48 hours. */
export const SESSION_DURATION_MS = 48 * 60 * 60 * 1000;

/**
 * Epochs the ephemeral key must stay valid for.
 *
 * Sui mainnet epochs are ~24h. Signing in at an arbitrary point within epoch E, a `maxEpoch` of E+2
 * expires at the end of epoch E+2 — between 48h and 72h away. So +2 is the smallest value that always
 * covers a full 48h window, and the session cookie (exactly 48h) is what actually ends the session.
 *
 * Going higher would not extend anything and some provers reject far-future epochs.
 */
export const SESSION_EPOCHS = 2;

/** Milliseconds until `expiresAt`, never negative. */
export function msUntil(expiresAt: number): number {
  return Math.max(0, expiresAt - Date.now());
}

/** Whether a timestamp is in the past. */
export function hasExpired(expiresAt: number | undefined | null): boolean {
  return !expiresAt || Date.now() >= expiresAt;
}

/** Compact "1d 4h" / "3h 20m" / "45m" for the UI. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'expired';
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}
