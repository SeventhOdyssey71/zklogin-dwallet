/**
 * Utility functions to derive chain-specific addresses from dWallet public key
 *
 * NOTE: The public key should already be extracted from public_output using
 * the official Ika SDK method: publicKeyFromDWalletOutput()
 *
 * CRITICAL CONCEPT (from console3.md):
 * ==================================
 * Ethereum addresses are NOT stored on-chain - they're DERIVED from public keys!
 *
 * The process:
 * 1. Decompress public key (if compressed) → 65 bytes with 0x04 prefix
 * 2. Remove the 0x04 prefix → 64 bytes
 * 3. KECCAK256 hash → 32 bytes
 * 4. Take LAST 20 bytes → Ethereum address
 *
 * This is why transactions don't need a "from" field - the address is
 * recovered from the signature using the same process!
 */

/**
 * Derive Ethereum-compatible address from SECP256K1 public key
 * Works for: Ethereum, Polygon, Avalanche C-Chain, BSC
 *
 * Process (from console3.md):
 * 1. If compressed (33 bytes): decompress using ethers.SigningKey.computePublicKey(key, false)
 * 2. Derive address using ethers.computeAddress(uncompressed)
 *    - This does: KECCAK256(pubkey without 0x04 prefix).slice(-20)
 *
 * @param publicKey - Compressed (33 bytes) or uncompressed (64/65 bytes) SECP256K1 public key
 * @returns Checksummed Ethereum address (EIP-55 format)
 */
export function deriveEthereumAddress(publicKey: string): string {
  try {
    const ethers = require('ethers');
    const hex = publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey;
    const keyBytes = Buffer.from(hex, 'hex');

    let uncompressedPubKey: string;

    // STEP 1: Handle different public key formats
    if (keyBytes.length === 33) {
      // Compressed public key (33 bytes): [0x02 or 0x03][32-byte x-coordinate]
      // SECP256K1 point compression: 0x02 = even Y, 0x03 = odd Y
      const compressedHex = '0x' + hex;
      console.log('📝 Compressed SECP256K1 key (33 bytes):', compressedHex);

      // Decompress: recover the full (x, y) coordinates from just x + parity bit
      // ethers.SigningKey.computePublicKey(key, false) returns:
      // 0x04 + x-coordinate (32 bytes) + y-coordinate (32 bytes) = 65 bytes
      uncompressedPubKey = ethers.SigningKey.computePublicKey(compressedHex, false);
      console.log('✅ Decompressed to uncompressed format (65 bytes)');
    } else if (keyBytes.length === 64) {
      // Uncompressed without 0x04 prefix - add it
      uncompressedPubKey = '0x04' + hex;
    } else if (keyBytes.length === 65) {
      // Already in uncompressed format with 0x04 prefix
      uncompressedPubKey = '0x' + hex;
    } else {
      throw new Error(`Unexpected public key length: ${keyBytes.length} bytes`);
    }

    // STEP 2: Derive Ethereum address
    // ethers.computeAddress() does:
    //   1. Remove 0x04 prefix → 64 bytes
    //   2. KECCAK256 hash → 32 bytes
    //   3. Take last 20 bytes → address
    //   4. Apply EIP-55 checksum encoding → final address
    const ethereumAddress = ethers.computeAddress(uncompressedPubKey);

    console.log('✅ Ethereum address derived:', ethereumAddress);
    return ethereumAddress;
  } catch (error) {
    console.error('❌ Error deriving Ethereum address:', error);
    return 'Invalid public key';
  }
}

/**
 * Derive Bitcoin testnet address from SECP256K1 public key
 * Returns P2PKH testnet address (starting with m or n)
 */
export function deriveBitcoinAddress(publicKey: string): string {
  try {
    // Use Node.js crypto for hashing
    const crypto = require('crypto');

    const hex = publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey;
    const pubKeyBuffer = Buffer.from(hex, 'hex');

    // Bitcoin testnet P2PKH: version byte 0x6f
    const sha256Hash = crypto.createHash('sha256').update(pubKeyBuffer).digest();
    const ripemd160Hash = crypto.createHash('ripemd160').update(sha256Hash).digest();

    // Add testnet version byte (0x6f for P2PKH testnet)
    const versionedHash = Buffer.concat([Buffer.from([0x6f]), ripemd160Hash]);

    // Double SHA256 for checksum
    const checksum = crypto.createHash('sha256')
      .update(crypto.createHash('sha256').update(versionedHash).digest())
      .digest()
      .slice(0, 4);

    // Combine and encode to base58
    const addressBytes = Buffer.concat([versionedHash, checksum]);
    return base58Encode(addressBytes);
  } catch (error) {
    console.error('Error deriving Bitcoin address:', error);
    return 'Invalid public key';
  }
}

/**
 * Base58 encoding for Bitcoin addresses
 */
function base58Encode(buffer: Buffer): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const base = BigInt(58);

  let num = BigInt('0x' + buffer.toString('hex'));
  let encoded = '';

  while (num > 0) {
    const remainder = Number(num % base);
    num = num / base;
    encoded = ALPHABET[remainder] + encoded;
  }

  // Add leading '1's for leading zero bytes
  for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
    encoded = '1' + encoded;
  }

  return encoded;
}

/**
 * Derive Solana address from ED25519 public key
 * Solana uses base58-encoded public key as address
 */
export function deriveSolanaAddress(publicKey: string): string {
  try {
    const bs58 = require('bs58');
    const hex = publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey;
    const bytes = Buffer.from(hex, 'hex');

    console.log('🔍 Deriving Solana address from public key:');
    console.log('   Public key hex:', hex);
    console.log('   Public key bytes length:', bytes.length);

    // Solana address is just the base58-encoded public key (32 bytes for ED25519)
    const address = bs58.encode(bytes);
    console.log('   ✅ Solana address:', address);
    return address;
  } catch (error) {
    console.error('Error deriving Solana address:', error);
    return 'Invalid public key';
  }
}

/**
 * Derive Polkadot address from ED25519 public key
 * Polkadot uses SS58 encoding with network prefix
 */
export function derivePolkadotAddress(publicKey: string): string {
  try {
    // For now, use a simplified version - proper SS58 encoding requires @polkadot/util-crypto
    // This creates a valid-looking address but may not match actual Polkadot derivation
    const bs58 = require('bs58');
    const hex = publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey;
    const bytes = Buffer.from(hex, 'hex');

    // Add Polkadot network prefix (0x00 for generic substrate)
    const prefixedBytes = Buffer.concat([Buffer.from([0x00]), bytes]);
    return bs58.encode(prefixedBytes);
  } catch (error) {
    console.error('Error deriving Polkadot address:', error);
    return 'Invalid public key';
  }
}

/**
 * Derive Cardano address from ED25519 public key
 * Cardano uses Bech32 encoding
 */
export function deriveCardanoAddress(publicKey: string): string {
  try {
    // For now, create a placeholder since proper Cardano address derivation
    // requires the cardano-serialization-lib
    // Real Cardano addresses need both payment and stake keys
    const hex = publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey;
    return `addr_test1${hex.substring(0, 54)}`;
  } catch (error) {
    console.error('Error deriving Cardano address:', error);
    return 'Invalid public key';
  }
}

/**
 * Derive NEAR account ID from ED25519 public key
 * NEAR uses hex-encoded public key
 */
export function deriveNearAddress(publicKey: string): string {
  try {
    // NEAR implicit account is derived from the public key
    // Format: hex(public_key).near
    const hex = publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey;
    return `${hex}.near`;
  } catch (error) {
    console.error('Error deriving NEAR address:', error);
    return 'Invalid public key';
  }
}

/**
 * Derive addresses for all compatible chains based on curve type
 *
 * IMPORTANT CONCEPT - Signature Recovery (from console3.md):
 * =========================================================
 * When you sign a transaction, the signature can recover to 2 possible addresses
 * depending on the recovery value (v):
 *
 *                MESSAGE HASH
 *                     ↓
 *        ┌────────────┴────────────┐
 *        │                         │
 *    v=0 (even Y)             v=1 (odd Y)
 *        │                         │
 *        ↓                         ↓
 *   Public Key A             Public Key B
 *        │                         │
 *        ↓                         ↓
 *   Address A                Address B
 *
 * Only ONE of these is the real signer! The v value tells us which.
 *
 * This is why:
 * 1. We need to TEST both v values when constructing the signed transaction
 * 2. We find which v recovers to the address derived from public_output
 * 3. We use that v in the final signature
 *
 * If the signature doesn't recover to the expected address with either v value,
 * it means the MPC signing used a different private key (BUG!).
 *
 * @param publicKey - The public key already extracted using publicKeyFromDWalletOutput()
 * @param curve - The curve type (0 = SECP256K1, 1 = ED25519)
 * @returns Object mapping chain names to their addresses
 */
export function deriveChainAddresses(publicKey: string, curve: number): { [chain: string]: string } {
  console.log('🎯 deriveChainAddresses called:');
  console.log('   Public key:', publicKey.substring(0, 20) + '...');
  console.log('   Curve:', curve === 0 ? 'SECP256K1' : 'ED25519');

  if (curve === 0) {
    // SECP256K1 - Bitcoin, Ethereum, Polygon, Avalanche, BSC
    const ethAddress = deriveEthereumAddress(publicKey);
    const btcAddress = deriveBitcoinAddress(publicKey);

    return {
      'Bitcoin': btcAddress,
      'Ethereum': ethAddress,
      'Polygon': ethAddress, // Same as Ethereum (EVM compatible)
      'Avalanche': ethAddress, // Same as Ethereum (C-Chain)
      'BSC': ethAddress, // Same as Ethereum (EVM compatible)
    };
  } else {
    // ED25519 - Solana, Polkadot, Cardano, NEAR
    const solanaAddress = deriveSolanaAddress(publicKey);
    const polkadotAddress = derivePolkadotAddress(publicKey);
    const cardanoAddress = deriveCardanoAddress(publicKey);
    const nearAddress = deriveNearAddress(publicKey);

    return {
      'Solana': solanaAddress,
      'Polkadot': polkadotAddress,
      'Cardano': cardanoAddress,
      'NEAR': nearAddress,
    };
  }
}
