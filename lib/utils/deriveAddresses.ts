/**
 * Utility functions to derive chain-specific addresses from dWallet public output
 */

import { computeAddress } from 'ethers';

/**
 * Parse the public_output from dWallet to extract the actual public key
 * Structure: [format_byte] [length] [public_key_bytes] [...]
 */
export function extractPublicKeyFromOutput(publicOutput: string): string {
  // Remove 0x prefix if present
  const hex = publicOutput.startsWith('0x') ? publicOutput.slice(2) : publicOutput;
  const bytes = Buffer.from(hex, 'hex');

  // Extract: byte 0 is format, byte 1 is length, remaining is the key
  const keyLength = bytes[1];
  const publicKey = bytes.slice(2, 2 + keyLength);

  return '0x' + publicKey.toString('hex');
}

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
 * Derive Bitcoin address from SECP256K1 public key
 * Returns P2PKH address (legacy format starting with 1)
 */
export function deriveBitcoinAddress(publicKey: string): string {
  // For now, return placeholder - proper implementation needs bitcoin address libraries
  // TODO: Implement proper Bitcoin address derivation
  return 'Bitcoin address derivation not implemented';
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
 */
export function deriveChainAddresses(publicOutput: string, curve: number): { [chain: string]: string } {
  const publicKey = extractPublicKeyFromOutput(publicOutput);

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
