/**
 * IkaClient initialization utilities
 */

import { Curve } from '@ika.xyz/sdk';
import type { AppSuiClient } from '@/lib/sui/client';
import { getIkaClient } from '@/lib/ika/ikaClient';
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
  suiClient: AppSuiClient,
  encryptionSeed: Uint8Array,
  curve: Curve,
  suiAddress: string
): Promise<SigningContext> {
  console.log('🔧 Initializing client-side signing...');

  // Shared, already-initialized client — constructing one per call cost a measured ~1.5s and threw
  // away its caches each time.
  const ikaClient = await getIkaClient(suiClient);

  // Generate user share encryption keys from seed
  const userShareEncryptionKeys = await generateEncryptionKeys(encryptionSeed, curve, suiAddress);

  return { ikaClient, userShareEncryptionKeys };
}
