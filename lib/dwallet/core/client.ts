/**
 * IkaClient initialization utilities
 */

import { SuiClient } from '@mysten/sui/client';
import { IkaClient, UserShareEncryptionKeys, Curve, getNetworkConfig } from '@ika.xyz/sdk';
import { SigningContext } from './types';
import { generateEncryptionKeys } from './encryption';

/**
 * Initialize IkaClient and UserShareEncryptionKeys for client-side signing
 *
 * @param suiClient - Sui blockchain client
 * @param encryptionSeed - Deterministic seed for encryption key generation
 * @param curve - Cryptographic curve (SECP256K1 or ED25519)
 * @returns Initialized signing context with IkaClient and encryption keys
 */
export async function initializeClientSideSigning(
  suiClient: SuiClient,
  encryptionSeed: Uint8Array,
  curve: Curve
): Promise<SigningContext> {
  console.log('🔧 Initializing client-side signing...');

  // Initialize IkaClient
  const ikaClient = new IkaClient({
    suiClient,
    config: getNetworkConfig('testnet'),
    cache: true,
  });
  await ikaClient.initialize();
  console.log('✅ IkaClient initialized');

  // Generate user share encryption keys from seed
  const userShareEncryptionKeys = await generateEncryptionKeys(encryptionSeed, curve);

  return { ikaClient, userShareEncryptionKeys };
}
