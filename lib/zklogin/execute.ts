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

import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import { signTxBytes, type EphemeralSession } from '@/lib/zklogin/zklogin';

// Must match the key used by useZkLogin().
export const EPH_KEY = 'zk.ephemeral';

export function loadEphemeral(): EphemeralSession | null {
  try {
    return JSON.parse(sessionStorage.getItem(EPH_KEY) ?? 'null');
  } catch {
    return null;
  }
}

/**
 * dapp-kit-compatible signer: pass `{ transaction }`, get `{ digest }`.
 * Drop-in for the `signAndExecuteTransaction` callback the Ika flow expects.
 */
export async function zkLoginSignAndExecute(
  suiClient: SuiClient,
  zkAddress: string,
  params: { transaction: Transaction }
): Promise<{ digest: string }> {
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
  return { digest: res.digest };
}
