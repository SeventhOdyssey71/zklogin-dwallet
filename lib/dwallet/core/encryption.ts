/**
 * Encryption utilities for dWallet user share encryption
 */

import { UserShareEncryptionKeys, Curve } from '@ika.xyz/sdk';
import { ethers } from 'ethers';

/**
 * Generate deterministic encryption seed from Sui wallet address and curve
 *
 * This ensures the same dWallet always gets the same encryption keys,
 * allowing recovery without storing the seed.
 */
export function generateDeterministicEncryptionSeed(
  suiAddress: string,
  curve: Curve
): Uint8Array {
  const curveString = curve === Curve.SECP256K1 ? 'secp256k1' : 'ed25519';
  const seedString = `ika-dwallet-${suiAddress}-${curveString}`;
  const seedHash = ethers.keccak256(ethers.toUtf8Bytes(seedString));

  console.log('✅ Regenerated DETERMINISTIC encryption seed from Sui address + curve');
  console.log(`🔐 Seed formula: KECCAK256("ika-dwallet-${suiAddress}-${curveString}")`);

  return ethers.getBytes(seedHash);
}

/**
 * Generate UserShareEncryptionKeys from encryption seed
 */
export async function generateEncryptionKeys(
  encryptionSeed: Uint8Array,
  curve: Curve
): Promise<UserShareEncryptionKeys> {
  const userShareEncryptionKeys = await UserShareEncryptionKeys.fromRootSeedKey(
    encryptionSeed,
    curve
  );

  console.log('✅ User share encryption keys generated');

  return userShareEncryptionKeys;
}
