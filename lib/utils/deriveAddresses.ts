/**
 * Utility functions to derive chain-specific addresses from dWallet public key
 *
 * NOTE: The public key should already be extracted from public_output using
 * the official Ika SDK method: publicKeyFromDWalletOutput()
 */

import { computeAddress } from 'ethers';

/**
 * Derive Ethereum-compatible address from SECP256K1 public key
 * Works for: Ethereum, Polygon, Avalanche C-Chain, BSC
 */
export function deriveEthereumAddress(publicKey: string): string {
  try {
    // ethers.computeAddress handles the keccak256 hashing
    return computeAddress(publicKey);
  } catch (error) {
    console.error('Error deriving Ethereum address:', error);
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

    // Solana address is just the base58-encoded public key (32 bytes for ED25519)
    return bs58.encode(bytes);
  } catch (error) {
    console.error('Error deriving Solana address:', error);
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
 * @param publicKey - The public key already extracted using publicKeyFromDWalletOutput()
 * @param curve - The curve type (0 = SECP256K1, 1 = ED25519)
 */
export function deriveChainAddresses(publicKey: string, curve: number): { [chain: string]: string } {
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
    const nearAddress = deriveNearAddress(publicKey);

    return {
      'Solana': solanaAddress,
      'Polkadot': solanaAddress, // Polkadot also uses base58, similar format to Solana
      'Cardano': solanaAddress, // Cardano uses bech32 but for now show as base58
      'NEAR': nearAddress,
    };
  }
}
