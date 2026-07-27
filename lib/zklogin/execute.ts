'use client';

/**
 * Sign + execute a client-built Sui Transaction with the zkLogin user's identity.
 *
 * This is the bridge between the Ika dWallet flow (which builds `Transaction`s client-side via the
 * SDK) and zkLogin signing. It replaces dapp-kit's `signAndExecuteTransaction`:
 *
 *   1. set the zkLogin address as sender and build the tx → BCS bytes (uses the CORS-friendly
 *      SuiClient from the provider — building queries gas coins for the sender).
 *   2. sign those exact bytes in the browser with the ephemeral key.
 *   3. POST to /api/zklogin/execute, which mints the Shinami proof, assembles the zkLogin
 *      signature, and submits — returning the on-chain digest.
 *
 * The ephemeral private key never leaves the browser; the server only sees the public key + sig.
 */

import { Transaction } from '@mysten/sui/transactions';
import type { AppSuiClient } from '@/lib/sui/client';
import { toBase64 } from '@mysten/sui/utils';
import { signTxBytes } from '@/lib/zklogin/zklogin';

// One implementation, shared with useZkLogin — it also enforces expiry and clears stale keys.
export { EPH_KEY, loadEphemeral } from '@/lib/zklogin/ephemeralStore';
import { loadEphemeral } from '@/lib/zklogin/ephemeralStore';

/**
 * The shape `/api/zklogin/execute` returns.
 *
 * `effects`, `events` and `objectChanges` come straight from execution, so callers can read a
 * transaction's outcome without a follow-up `waitForTransaction` — which had to wait for the fullnode
 * to index the transaction first, roughly a second per transaction on the send path.
 */
export interface ZkLoginExecuteResult {
  digest: string;
  effects?: unknown;
  events?: unknown;
  objectChanges?: unknown;
}

/**
 * dapp-kit-compatible signer: pass `{ transaction }`, get `{ digest, effects, events, objectChanges }`.
 * Drop-in for the `signAndExecuteTransaction` callback the Ika flow expects.
 */
export async function zkLoginSignAndExecute(
  suiClient: AppSuiClient,
  zkAddress: string,
  params: { transaction: Transaction }
): Promise<ZkLoginExecuteResult> {
  const eph = loadEphemeral();
  if (!eph) throw new Error('No zkLogin session — please sign in again.');

  const tx = params.transaction;
  tx.setSender(zkAddress);
  const txBytes = await tx.build({ client: suiClient });

  const userSignature = await signTxBytes(eph, txBytes);

  const res = await fetch('/api/zklogin/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      txBytesB64: toBase64(txBytes),
      userSignature,
      ephemeralPubKeyB64: eph.publicKeyB64,
      maxEpoch: eph.maxEpoch,
      randomness: eph.randomness,
    }),
  }).then((r) => r.json());

  if (!res.digest) throw new Error(res.detail ?? res.error ?? 'zkLogin execute failed');
  return {
    digest: res.digest,
    effects: res.effects,
    events: res.events,
    objectChanges: res.objectChanges,
  };
}

/**
 * Mint and cache the zkLogin Groth16 proof ahead of any transaction.
 *
 * The proof depends only on the ephemeral session (not on any transaction) and costs ~2-4s, so
 * minting it while the user is still on the wallet screen removes it from the first send entirely.
 * Fire-and-forget: a failure here just means the first transaction pays for it as before.
 */
let prewarming: Promise<boolean> | null = null;

export function prewarmZkLoginProof(): Promise<boolean> {
  /**
   * One mint per session, however many callers ask.
   *
   * The proof depends only on the ephemeral session, so a second request can only ever return the same
   * cached answer — but it is still a round-trip, and both the send dialog and the swap flow now ask for
   * it. Sharing the promise also means a caller arriving mid-flight waits for the existing mint instead
   * of starting a competing one.
   */
  prewarming ??= mintProof().catch((e) => {
    prewarming = null; // never cache a failure; the next attempt should retry
    throw e;
  });
  return prewarming.catch(() => false);
}

/** Drop the cached mint on sign-out, so the next user does not inherit it. */
export function clearZkLoginProofWarmup(): void {
  prewarming = null;
}

async function mintProof(): Promise<boolean> {
  const eph = loadEphemeral();
  if (!eph) return false;
  try {
    const res = await fetch('/api/zklogin/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prewarmOnly: true,
        ephemeralPubKeyB64: eph.publicKeyB64,
        maxEpoch: eph.maxEpoch,
        randomness: eph.randomness,
      }),
    }).then((r) => r.json());
    return res?.prewarmed === true;
  } catch {
    return false;
  }
}
