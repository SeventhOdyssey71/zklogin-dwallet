'use client';

/**
 * Decrypt the user's dWallet key share ahead of the send.
 *
 * WHY
 * ---
 * A real send measured 33.6s wall clock while the instrumented phases summed to 14.6s. The missing 19s was
 * all inside `IkaTransaction.requestSign`, which does two things: decrypt the user's key share with
 * class-groups crypto, then compute the client's half of the signature. Only the second half depends on the
 * message — the decryption is a pure function of (dWallet, encrypted share, encryption keys), none of which
 * involve the recipient or the amount.
 *
 * So it can be done while the user is still filling in the form, exactly like the presignature. Passing the
 * already-decrypted `secretShare` to `requestSign` leaves only the message-dependent work on the critical
 * path.
 *
 * VERIFICATION IS NOT SKIPPED
 * ---------------------------
 * The SDK warns that supplying `secretShare` directly means `requestSign` "does not verify `secretShare`
 * and `publicOutput`" — which would matter a great deal, since the network supplies both. That warning is
 * about hand-constructed shares. This module obtains the share from `UserShareEncryptionKeys.decryptUserShare`,
 * which performs the full chain of checks the SDK would otherwise perform internally:
 *
 *   1. the dWallet is Active and has a public output,
 *   2. the encrypted share's signature verifies against the signing key,
 *   3. decryption succeeds with the class-groups decryption key,
 *   4. the decrypted share is consistent with the public output.
 *
 * We then pass its `verifiedPublicOutput` — not the raw on-chain value — so the pair handed to `requestSign`
 * is precisely the pair the SDK itself would have derived. Nothing is taken on trust that was not before.
 *
 * WHY MEMORY ONLY
 * ---------------
 * Unlike the share-*encryption* keys (which are deterministically derivable from the public Sui address, so
 * caching them grants nothing), this is the decrypted key share itself — one of the two halves that sign.
 * It is held in memory for the session and never written to storage, and it is dropped on sign-out.
 */

import type { Curve } from '@ika.xyz/sdk';
import type { AppSuiClient } from '@/lib/sui/client';
import { getIkaClient } from '@/lib/ika/ikaClient';
import { ensureProtocolPublicParameters } from '@/lib/ika/protocolParams';

export interface DecryptedShare {
  secretShare: Uint8Array;
  /** The public output as verified during decryption, not the raw on-chain field. */
  publicOutput: Uint8Array;
}

const cache = new Map<string, DecryptedShare>();
const inflight = new Map<string, Promise<DecryptedShare>>();

const keyOf = (dwalletId: string, shareId: string) => `${dwalletId}:${shareId}`;

/** A previously decrypted share, if one is ready. Synchronous: never blocks the send path. */
export function peekUserShare(dwalletId: string, shareId: string): DecryptedShare | undefined {
  return cache.get(keyOf(dwalletId, shareId));
}

/**
 * Decrypt and cache the share, or join an in-flight decryption.
 *
 * Safe to call repeatedly — the second call is free.
 */
export function prepareUserShare(params: {
  suiClient: AppSuiClient;
  dwalletId: string;
  shareId: string;
  curve: Curve;
  /** The dWallet object, already fetched by the caller. */
  dWallet: unknown;
  /** The encrypted share object, already fetched by the caller. */
  encryptedShare: unknown;
  /** The user's share-encryption keys for this curve. */
  userShareEncryptionKeys: {
    decryptUserShare: (
      dWallet: never,
      encryptedShare: never,
      protocolPublicParameters: Uint8Array
    ) => Promise<{ verifiedPublicOutput: Uint8Array; secretShare: Uint8Array }>;
  };
}): Promise<DecryptedShare> {
  const k = keyOf(params.dwalletId, params.shareId);

  const ready = cache.get(k);
  if (ready) return Promise.resolve(ready);

  const running = inflight.get(k);
  if (running) return running;

  const job = (async (): Promise<DecryptedShare> => {
    const ikaClient = await getIkaClient(params.suiClient);
    // Protocol public parameters are large and cached inside the shared IkaClient, so this is cheap
    // after the first call in a session. Routed through `ensureProtocolPublicParameters` rather than
    // called directly because the SDK's own path currently throws against mainnet — see
    // lib/ika/protocolParams.ts. That helper also primes the client's cache, which is what makes the
    // call `requestSign` performs internally succeed later on.
    const protocolPublicParameters = await ensureProtocolPublicParameters(
      ikaClient,
      params.suiClient,
      params.dWallet,
      params.curve
    );

    const { secretShare, verifiedPublicOutput } =
      await params.userShareEncryptionKeys.decryptUserShare(
        params.dWallet as never,
        params.encryptedShare as never,
        protocolPublicParameters
      );

    const result: DecryptedShare = { secretShare, publicOutput: verifiedPublicOutput };
    cache.set(k, result);
    return result;
  })()
    .catch((e) => {
      // Never cache a failure: the send path falls back to letting requestSign decrypt internally, which
      // is simply the old (slower) behaviour rather than a broken one.
      inflight.delete(k);
      throw e;
    })
    .finally(() => {
      inflight.delete(k);
    });

  inflight.set(k, job);
  return job;
}

/** Drop every decrypted share. Called on sign-out. */
export function clearUserShares(): void {
  cache.clear();
  inflight.clear();
}
