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
    // bs58 might be a default export or have .default property
    const encode = bs58.encode || bs58.default?.encode || bs58.default;
    const address = typeof encode === 'function' ? encode(bytes) : bs58(bytes);
    console.log('   ✅ Solana address:', address);
    return address;
  } catch (error) {
    console.error('Error deriving Solana address:', error);
    return 'Invalid public key';
  }
}

/**
 * Derive Polkadot address from ED25519 public key
 * Polkadot uses SS58 encoding with Blake2b hash and checksum
 *
 * SS58 Format: [prefix][payload][checksum]
 * - prefix: network identifier (0 for Polkadot, 42 for generic Substrate)
 * - payload: public key (32 bytes)
 * - checksum: first 2 bytes of Blake2b-512 hash of [prefix][payload]
 */
export function derivePolkadotAddress(publicKey: string): string {
  try {
    const { blake2b } = require('blakejs');
    const bs58 = require('bs58');

    const hex = publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey;
    const pubKeyBytes = Buffer.from(hex, 'hex');

    // Polkadot mainnet uses prefix 0
    const prefix = Buffer.from([0x00]);

    // SS58 prefix constant for checksum calculation
    const SS58_PREFIX = Buffer.from('SS58PRE');

    // Combine prefix + public key
    const payload = Buffer.concat([prefix, pubKeyBytes]);

    // Calculate checksum: first 2 bytes of Blake2b-512(SS58PRE + prefix + pubkey)
    // blakejs returns Uint8Array, convert to Buffer
    const hashInput = Buffer.concat([SS58_PREFIX, payload]);
    const hash = Buffer.from(blake2b(hashInput, null, 64)); // 64 bytes = 512 bits
    const checksum = hash.slice(0, 2);

    // Final address: prefix + pubkey + checksum
    const address = Buffer.concat([payload, checksum]);

    // Base58 encode
    // bs58 might be a default export or have .default property
    const encode = bs58.encode || bs58.default?.encode || bs58.default;
    return typeof encode === 'function' ? encode(address) : bs58(address);
  } catch (error) {
    console.error('Error deriving Polkadot address:', error);
    return 'Invalid public key';
  }
}

/**
 * Derive Cardano address from ED25519 public key
 * Cardano uses Bech32 encoding with Blake2b-224 hash
 *
 * Cardano Address Structure (Shelley era, CIP-19):
 * - Header: 1 byte [type:4bits][network:4bits]
 *   - Type 0 = base address (payment + stake key hashes)
 *   - Network 0 = testnet, Network 1 = mainnet
 *   - So 0x00 = testnet base address
 * - Payment Key Hash: 28 bytes (Blake2b-224 of public key)
 * - Stake Key Hash: 28 bytes (using same key for simplicity)
 * - Bech32 encoding with 'addr_test' prefix for testnet
 */
export function deriveCardanoAddress(publicKey: string): string {
  try {
    const { blake2b } = require('blakejs');
    const { bech32 } = require('bech32');

    const hex = publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey;
    const pubKeyBytes = Buffer.from(hex, 'hex');

    // Hash the public key using Blake2b-224 (28 bytes = 224 bits)
    // blakejs returns Uint8Array, convert to Buffer
    const paymentKeyHash = Buffer.from(blake2b(pubKeyBytes, null, 28)); // 28 bytes = 224 bits

    // For simplicity, use the same key hash for stake key
    // In production, you'd derive a separate stake key
    const stakeKeyHash = paymentKeyHash;

    // Address header: 0x00 for testnet base address (payment + stake)
    // Bits: 0000 (type=base) 0000 (network=testnet)
    const header = Buffer.from([0x00]);

    // Combine: header + payment key hash + stake key hash
    const payload = Buffer.concat([header, paymentKeyHash, stakeKeyHash]);

    console.log('🔍 Cardano address derivation:');
    console.log('   Public key length:', pubKeyBytes.length, 'bytes');
    console.log('   Payment key hash length:', paymentKeyHash.length, 'bytes');
    console.log('   Total payload length:', payload.length, 'bytes (should be 57)');

    // Convert to 5-bit groups for bech32
    const words = bech32.toWords(payload);

    // Encode with 'addr_test' prefix for Cardano testnet
    const address = bech32.encode('addr_test', words, 1000); // limit=1000 for long addresses
    console.log('   ✅ Cardano testnet address:', address);

    return address;
  } catch (error) {
    console.error('Error deriving Cardano address:', error);
    return 'Invalid public key';
  }
}

/**
 * Derive NEAR account ID from ED25519 public key
 * NEAR implicit accounts use the lowercase hex public key (64 chars, no .near suffix)
 *
 * Format: 32-byte ED25519 public key → 64 lowercase hex characters
 * Example: 98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de
 */
export function deriveNearAddress(publicKey: string): string {
  try {
    // NEAR implicit account is the lowercase hex-encoded public key (64 characters)
    // Named accounts have .near/.testnet suffix, but implicit accounts don't
    const hex = publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey;
    return hex.toLowerCase();  // NEAR requires lowercase hex
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
