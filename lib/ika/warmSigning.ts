'use client';

/**
 * Resolve the expensive, transaction-independent parts of signing as early as possible.
 *
 * WHY THIS EXISTS
 * ---------------
 * A real send measured 48.5s, and the phase table put 35s of it — 72% — in a single row: `protocol params`.
 * That work is completely independent of the recipient, the amount, and even which dWallet signs. It
 * depends only on (network encryption key, curve). So it has no business being on the path between
 * pressing Send and the transaction going out.
 *
 * It was already warmed when the send dialog opened, which was not early enough: resolving takes ~35s cold,
 * and anyone who types a recipient and an amount in less than that simply waits out the remainder. Exactly
 * the same mistake the presignature pool was built to fix, in a different place — a warm-up is only a
 * warm-up if it finishes before the thing it is warming.
 *
 * Starting at dashboard load instead gives it the entire time a user spends looking at their balances,
 * which is far more than 35 seconds of head start in practice.
 *
 * WHY THE COST IS UNAVOIDABLE, AND WHY IT ONLY HAPPENS ONCE
 * --------------------------------------------------------
 * The 35s is not overhead we added. It is: paging a 360-entry epoch table, reading a ~275KB payload out of
 * a TableVec one dynamic field at a time, and a wasm conversion that produces **44MB** of parameters. The
 * conversion dominates and cannot be avoided — those 44MB are an input the signing protocol requires.
 *
 * It happens once per page load per curve. `ensureProtocolPublicParameters` primes the SDK's own cache, so
 * every later send on that curve reads it for free. Redis caches the *epoch hint* across page loads, which
 * removes the table walk but not the conversion.
 */

import type { IkaClient } from '@ika.xyz/sdk';
import { Curve } from '@ika.xyz/sdk';
import type { AppSuiClient } from '@/lib/sui/client';
import { ensureProtocolPublicParameters } from '@/lib/ika/protocolParams';

/**
 * Curves worth warming.
 *
 * Only the two that back a live chain. Ristretto is deliberately absent — Polkadot was removed, so warming
 * it would spend 35s of wasm on parameters nothing can use.
 */
const LIVE_CURVES: Curve[] = [Curve.SECP256K1, Curve.ED25519];

/** In-flight and completed warm-ups, so a re-render or a second view cannot start a duplicate. */
const started = new Map<string, Promise<unknown>>();

/**
 * Begin resolving protocol public parameters for every live curve.
 *
 * Fire-and-forget by design: the caller should not await it. A failure is swallowed because the send path
 * resolves them itself if this has not finished — the warm-up only ever makes a send faster, never
 * possible or impossible.
 *
 * Curves run concurrently. The two conversions are independent, and the wasm work is the bulk of the cost.
 */
export function warmSigning(ikaClient: IkaClient, suiClient: AppSuiClient): void {
  for (const curve of LIVE_CURVES) {
    const key = String(curve);
    if (started.has(key)) continue;

    const job = ensureProtocolPublicParameters(ikaClient, suiClient, undefined, curve).catch((e) => {
      // Not cached as a failure: a transient RPC problem should not permanently disable the warm-up.
      started.delete(key);
      console.warn(
        `[warm] protocol parameters for ${key} not pre-resolved (harmless, the send will do it):`,
        e instanceof Error ? e.message : e
      );
      return undefined;
    });

    started.set(key, job);
  }
}

/** Whether every live curve has finished warming. Used only for honest UI copy. */
export function signingWarm(): boolean {
  return LIVE_CURVES.every((c) => started.has(String(c)));
}

/** Drop warm-up state on sign-out so nothing is retained across users. */
export function clearSigningWarmup(): void {
  started.clear();
}
