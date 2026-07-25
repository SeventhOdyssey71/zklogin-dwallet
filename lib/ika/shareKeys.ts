/**
 * Cached `UserShareEncryptionKeys`.
 *
 * `UserShareEncryptionKeys.fromRootSeedKey` generates a class-groups keypair in wasm and takes
 * **~5 seconds per curve** on a normal laptop, blocking the main thread the whole time. It is paid on
 * every dWallet creation *and* on every single send, since signing needs the same keys to decrypt the
 * user share — so a three-curve creation spends ~15s here, and each transfer another ~5s.
 *
 * The keys are fully deterministic from (Sui address, curve), so re-deriving them is pure waste.
 * The SDK exposes `toShareEncryptionKeysBytes()` / `fromShareEncryptionKeysBytes()`, and this caches
 * that serialized form.
 *
 * WHAT IS CACHED, AND WHY THAT IS SAFE
 * ------------------------------------
 * The cached blob contains the class-groups *decryption* key. It is derived deterministically from
 * `keccak256("ika-dwallet-<suiAddress>-<curve>")` — a formula anyone can recompute from the public
 * address — so it is not a secret in the first place, and caching it grants an attacker nothing they
 * could not derive themselves. What actually protects the dWallet is the network's share plus the
 * zkLogin signature required to authorise a session; this key only decrypts the user share.
 *
 * It is still scoped per address and held in `sessionStorage` rather than `localStorage`, so it dies
 * with the tab instead of persisting on a shared machine.
 */

import { UserShareEncryptionKeys, Curve } from '@ika.xyz/sdk';

/** Bumped if the derivation formula or SDK serialization format ever changes. */
const CACHE_VERSION = 'v1';

const keyFor = (suiAddress: string, curve: Curve) =>
  `ika.shareKeys.${CACHE_VERSION}.${suiAddress}.${String(curve)}`;

/** In-memory cache too: avoids base64 round-trips within a single page view. */
const memory = new Map<string, UserShareEncryptionKeys>();

const toB64 = (b: Uint8Array) => {
  let s = '';
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s);
};

const fromB64 = (s: string) => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/**
 * Get the user's share-encryption keys for a curve, deriving them only if not already cached.
 *
 * Falls through to a plain derivation whenever storage is unavailable or the cached bytes fail to
 * deserialize — a stale or corrupt cache must never be able to break wallet access.
 */
export async function getShareEncryptionKeys(params: {
  suiAddress: string;
  curve: Curve;
  rootSeed: Uint8Array;
}): Promise<UserShareEncryptionKeys> {
  const { suiAddress, curve, rootSeed } = params;
  const cacheKey = keyFor(suiAddress, curve);

  const inMemory = memory.get(cacheKey);
  if (inMemory) return inMemory;

  if (typeof window !== 'undefined') {
    try {
      const stored = window.sessionStorage.getItem(cacheKey);
      if (stored) {
        const keys = UserShareEncryptionKeys.fromShareEncryptionKeysBytes(fromB64(stored));
        memory.set(cacheKey, keys);
        return keys;
      }
    } catch (e) {
      console.warn('[shareKeys] cached keys unusable, re-deriving:', e);
      try {
        window.sessionStorage.removeItem(cacheKey);
      } catch {
        /* storage unavailable */
      }
    }
  }

  const keys = await UserShareEncryptionKeys.fromRootSeedKey(rootSeed, curve);
  memory.set(cacheKey, keys);

  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(cacheKey, toB64(keys.toShareEncryptionKeysBytes()));
    } catch {
      // Quota or private-mode failure is not fatal; we just pay the derivation again next time.
    }
  }

  return keys;
}

/** Drop cached keys for an address — used on sign-out. */
export function clearShareEncryptionKeys(suiAddress?: string): void {
  for (const k of [...memory.keys()]) {
    if (!suiAddress || k.includes(suiAddress)) memory.delete(k);
  }
  if (typeof window === 'undefined') return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k?.startsWith('ika.shareKeys.') && (!suiAddress || k.includes(suiAddress))) doomed.push(k);
    }
    for (const k of doomed) window.sessionStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
}
