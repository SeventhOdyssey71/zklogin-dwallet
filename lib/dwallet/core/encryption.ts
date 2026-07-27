/**
 * Encryption utilities for dWallet user share encryption
 */

import { UserShareEncryptionKeys, Curve } from '@ika.xyz/sdk';
import { ethers } from 'ethers';
import { getShareEncryptionKeys } from '@/lib/ika/shareKeys';
import { debug } from '@/lib/utils/log';

/**
 * The curve's label in the seed formula.
 *
 * WHY THIS IS A MAP AND NOT A TERNARY
 * ----------------------------------
 * It used to be `curve === SECP256K1 ? 'secp256k1' : 'ed25519'`, which silently collapsed BOTH ristretto and
 * secp256r1 onto `'ed25519'`. The consequence was not cosmetic: a ristretto dWallet's share-encryption keys
 * were derived from the wrong seed, so `decryptUserShare` failed with "Invalid signature" before any protocol
 * parameter was even used, and Polkadot could receive but never send.
 *
 * THE TWO LIVE VALUES MUST NEVER CHANGE
 * ------------------------------------
 * These strings are load-bearing. The seed is `keccak256("ika-dwallet-<address>-<label>")` and it is what
 * derives the class-groups keys that decrypt the user share. Changing `secp256k1` or `ed25519` would derive
 * different keys for every dWallet already in existence and lock their owners out permanently — there is no
 * migration, because the network holds a share encrypted to the old key.
 *
 * Ristretto and secp256r1 are safe to correct precisely because nothing working depends on them: the old
 * value produced a share that never verified, and no dWallet is created on either curve today.
 *
 * Exhaustive by construction — `Record<Curve, string>` means a curve added to the SDK fails the build here
 * rather than silently inheriting another curve's seed, which is exactly how this bug arrived.
 */
const CURVE_SEED_LABEL: Record<Curve, string> = {
  [Curve.SECP256K1]: 'secp256k1',
  [Curve.ED25519]: 'ed25519',
  [Curve.RISTRETTO]: 'ristretto',
  [Curve.SECP256R1]: 'secp256r1',
};

/**
 * Generate the deterministic encryption seed from the Sui address and curve.
 *
 * Deterministic so the same dWallet always derives the same encryption keys, which is what makes recovery
 * possible without storing anything.
 */
export function generateDeterministicEncryptionSeed(
  suiAddress: string,
  curve: Curve
): Uint8Array {
  const curveString = CURVE_SEED_LABEL[curve];
  if (!curveString) {
    // Better to refuse than to guess: a wrong label derives keys that cannot decrypt the share.
    throw new Error(`No seed label for curve ${String(curve)} — refusing to derive a wrong key.`);
  }

  const seedString = `ika-dwallet-${suiAddress}-${curveString}`;
  const seedHash = ethers.keccak256(ethers.toUtf8Bytes(seedString));

  // Gated: this printed the address and the exact seed formula on every send and every dWallet read.
  if (process.env.NEXT_PUBLIC_DEBUG_SIGNING === '1') {
    debug(`🔐 Seed formula: KECCAK256("ika-dwallet-${suiAddress}-${curveString}")`);
  }

  return ethers.getBytes(seedHash);
}

/**
 * Resolve UserShareEncryptionKeys for a curve.
 *
 * Goes through the cache in `lib/ika/shareKeys.ts`: deriving these takes ~5s of blocking wasm and is
 * otherwise repeated on every single send, since signing needs the same keys to decrypt the user share.
 */
export async function generateEncryptionKeys(
  encryptionSeed: Uint8Array,
  curve: Curve,
  suiAddress: string
): Promise<UserShareEncryptionKeys> {
  const keys = await getShareEncryptionKeys({ suiAddress, curve, rootSeed: encryptionSeed });
  if (process.env.NEXT_PUBLIC_DEBUG_SIGNING === '1') {
    debug('✅ User share encryption keys ready');
  }
  return keys;
}
