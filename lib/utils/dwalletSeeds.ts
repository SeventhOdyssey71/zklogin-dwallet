/**
 * dWallet Deterministic Seed Generation
 *
 * Implements indexed deterministic seed approach (similar to BIP32/BIP44)
 * to allow creation of unlimited dWallets while maintaining recoverability.
 *
 * Key Features:
 * - Deterministic: Same Sui address + index + curve → Same seed
 * - Recoverable: Can regenerate seeds knowing only Sui address and index
 * - Unlimited: Separate counters for ECDSA and EdDSA allow unlimited wallets
 * - Solves ECDSA signature recovery issue
 */

import { ethers } from 'ethers';

/**
 * Configuration for generating deterministic seeds
 */
export interface DWalletSeedConfig {
  suiAddress: string;
  index: number;
  curve: 'secp256k1' | 'ed25519';
}

/**
 * Registry entry for tracking created dWallets
 */
export interface DWalletRegistryEntry {
  dwalletId: string;
  curve: 'secp256k1' | 'ed25519';
  index: number;
  createdAt: string;
  publicKey?: string;
  ethereumAddress?: string;
  bitcoinAddress?: string;
  solanaAddress?: string;
}

/**
 * Registry structure for a Sui address
 */
export interface DWalletRegistry {
  suiAddress: string;
  ecdsaCount: number;
  eddsaCount: number;
  dwallets: DWalletRegistryEntry[];
}

/**
 * Generate a deterministic encryption seed
 *
 * Format: KECCAK256(`ika-dwallet-${suiAddress}-${index}-${curve}`)
 *
 * This ensures:
 * - Same inputs always produce same seed (deterministic)
 * - Can regenerate seed knowing Sui address, index, and curve (recoverable)
 * - Different indexes produce different seeds (unlimited wallets)
 * - ECDSA signatures will recover to correct addresses (solves recovery issue)
 *
 * @param config - Seed generation configuration
 * @returns 32-byte deterministic seed
 */
export function generateDeterministicSeed(config: DWalletSeedConfig): Uint8Array {
  const { suiAddress, index, curve } = config;

  // Create deterministic seed string
  const seedString = `ika-dwallet-${suiAddress}-${index}-${curve}`;

  // Hash to create 32-byte seed
  const hash = ethers.keccak256(ethers.toUtf8Bytes(seedString));

  // Convert to Uint8Array
  return ethers.getBytes(hash);
}

/**
 * Get the next available index for a curve type
 *
 * Separate counters for ECDSA and EdDSA allow unlimited wallets of each type
 *
 * @param suiAddress - Sui wallet address
 * @param curve - Curve type (secp256k1 or ed25519)
 * @returns Next available index (0 if none exist)
 */
export function getNextIndex(
  suiAddress: string,
  curve: 'secp256k1' | 'ed25519'
): number {
  const registry = getRegistry(suiAddress);

  const curveKey = curve === 'secp256k1' ? 'ecdsaCount' : 'eddsaCount';
  return registry[curveKey] || 0;
}

/**
 * Increment the index counter for a curve type
 *
 * Call this after successfully creating a dWallet
 *
 * @param suiAddress - Sui wallet address
 * @param curve - Curve type (secp256k1 or ed25519)
 * @returns New index value
 */
export function incrementIndex(
  suiAddress: string,
  curve: 'secp256k1' | 'ed25519'
): number {
  const registry = getRegistry(suiAddress);

  const curveKey = curve === 'secp256k1' ? 'ecdsaCount' : 'eddsaCount';
  registry[curveKey] = (registry[curveKey] || 0) + 1;

  saveRegistry(suiAddress, registry);

  return registry[curveKey];
}

/**
 * Register a newly created dWallet
 *
 * Stores metadata for recovery and tracking
 *
 * @param suiAddress - Sui wallet address
 * @param entry - dWallet registry entry
 */
export function registerDWallet(
  suiAddress: string,
  entry: DWalletRegistryEntry
): void {
  const registry = getRegistry(suiAddress);

  // Add to registry
  registry.dwallets.push(entry);

  // Save
  saveRegistry(suiAddress, registry);

  console.log(`✅ Registered dWallet ${entry.dwalletId} (${entry.curve} index ${entry.index})`);
}

/**
 * Get all dWallets for a Sui address
 *
 * @param suiAddress - Sui wallet address
 * @param curve - Optional: filter by curve type
 * @returns Array of dWallet registry entries
 */
export function getDWallets(
  suiAddress: string,
  curve?: 'secp256k1' | 'ed25519'
): DWalletRegistryEntry[] {
  const registry = getRegistry(suiAddress);

  if (curve) {
    return registry.dwallets.filter(d => d.curve === curve);
  }

  return registry.dwallets;
}

/**
 * Get a specific dWallet by ID
 *
 * @param suiAddress - Sui wallet address
 * @param dwalletId - dWallet object ID
 * @returns Registry entry or undefined
 */
export function getDWallet(
  suiAddress: string,
  dwalletId: string
): DWalletRegistryEntry | undefined {
  const registry = getRegistry(suiAddress);
  return registry.dwallets.find(d => d.dwalletId === dwalletId);
}

/**
 * Regenerate encryption seed for an existing dWallet
 *
 * This is the recovery function - can regenerate the seed
 * knowing only the Sui address and the dWallet's index
 *
 * @param suiAddress - Sui wallet address
 * @param dwalletId - dWallet object ID
 * @returns Regenerated encryption seed or null if not found
 */
export function regenerateSeed(
  suiAddress: string,
  dwalletId: string
): Uint8Array | null {
  const dwallet = getDWallet(suiAddress, dwalletId);

  if (!dwallet) {
    console.error(`❌ dWallet ${dwalletId} not found in registry`);
    return null;
  }

  // Regenerate the seed using stored index and curve
  const seed = generateDeterministicSeed({
    suiAddress,
    index: dwallet.index,
    curve: dwallet.curve,
  });

  console.log(`✅ Regenerated seed for dWallet ${dwalletId} (${dwallet.curve} index ${dwallet.index})`);

  return seed;
}

/**
 * Get registry for a Sui address
 *
 * @param suiAddress - Sui wallet address
 * @returns Registry object
 */
function getRegistry(suiAddress: string): DWalletRegistry {
  const registryKey = `dwallet_registry_${suiAddress}`;
  const registryJson = localStorage.getItem(registryKey);

  if (!registryJson) {
    // Initialize empty registry
    return {
      suiAddress,
      ecdsaCount: 0,
      eddsaCount: 0,
      dwallets: [],
    };
  }

  return JSON.parse(registryJson);
}

/**
 * Save registry for a Sui address
 *
 * @param suiAddress - Sui wallet address
 * @param registry - Registry object to save
 */
function saveRegistry(suiAddress: string, registry: DWalletRegistry): void {
  const registryKey = `dwallet_registry_${suiAddress}`;
  localStorage.setItem(registryKey, JSON.stringify(registry, null, 2));
}

/**
 * Clear all registry data (for testing/debugging)
 *
 * @param suiAddress - Sui wallet address
 */
export function clearRegistry(suiAddress: string): void {
  const registryKey = `dwallet_registry_${suiAddress}`;
  localStorage.removeItem(registryKey);
  console.log(`🗑️  Cleared registry for ${suiAddress}`);
}

/**
 * Export registry data (for backup)
 *
 * @param suiAddress - Sui wallet address
 * @returns Registry JSON string
 */
export function exportRegistry(suiAddress: string): string {
  const registry = getRegistry(suiAddress);
  return JSON.stringify(registry, null, 2);
}

/**
 * Import registry data (from backup)
 *
 * @param suiAddress - Sui wallet address
 * @param registryJson - Registry JSON string
 */
export function importRegistry(suiAddress: string, registryJson: string): void {
  const registry = JSON.parse(registryJson);
  saveRegistry(suiAddress, registry);
  console.log(`📥 Imported registry for ${suiAddress}`);
}
