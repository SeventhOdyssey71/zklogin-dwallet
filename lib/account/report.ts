'use client';

/**
 * The browser's side of the durable record.
 *
 * Two facts get written to Postgres from the client — that an account exists and which addresses it
 * derives, and that value moved — and both are posted from here so there is one place that knows the
 * rules rather than a `fetch` inlined at each call site.
 *
 * FIRE-AND-FORGET, WITHOUT EXCEPTION
 * ----------------------------------
 * Nothing here is awaited and nothing here can fail visibly. These calls sit on paths the user is
 * watching: a dashboard that has just finished discovering fourteen addresses, and a send that has just
 * been broadcast. The database is a record of what happened, so it is written *after* the thing happened
 * and can never be the reason it didn't — a slow write must not delay a transaction, and a dead database
 * must not fail one.
 *
 * THE ADDRESS IS NEVER SENT
 * -------------------------
 * Every payload here omits the Sui address on purpose. The server reads it from the sealed session
 * cookie, so a client cannot attach addresses to, or file volume against, an account that isn't theirs.
 * Adding it "for convenience" would hand that over.
 */

/** Matches `sanitizeAddress` in app/api/account/route.ts. `curve` is Ika's on-chain integer. */
export interface ReportedAddress {
  chain: string;
  address: string;
  curve: number;
}

/**
 * Record the signed-in account, and optionally the addresses it derives.
 *
 * Called on sign-in with nothing, and again after discovery with the full set. The sign-in call is not
 * redundant: an account that has not created its dWallets yet derives no addresses at all, and would
 * otherwise never appear — which is exactly the population you want to be able to count.
 */
export function reportAccount(addresses?: readonly ReportedAddress[]): void {
  if (typeof window === 'undefined') return;
  void fetch('/api/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addresses: addresses ?? [] }),
  }).catch(() => {
    // Offline, signed out, or the database is down. Nothing downstream depends on this having landed.
  });
}

/**
 * Record an outbound transaction — a send or a swap.
 *
 * Distinct from the history push in lib/history/store.ts, and both run. History is this account's list:
 * capped, evictable, and inclusive of receives detected from a balance rising. This is the row that
 * volume is summed from: outbound only, never expired, aggregated across users. Neither store can be
 * rebuilt from the other.
 *
 * Amounts are sent as the decimal string that was displayed, not as a number. The server writes it
 * straight into `numeric`, so an 18-decimal transfer keeps every digit instead of being rounded by a
 * round trip through a JS double.
 */
export function reportTransaction(params: {
  kind: 'send' | 'swap';
  chain: string;
  symbol: string;
  amount: string;
  counterparty?: string;
  txHash?: string;
}): void {
  if (typeof window === 'undefined') return;
  void fetch('/api/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch(() => {
    // The chain and the local history both still have this; the aggregate is what misses out.
  });
}
