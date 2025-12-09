/**
 * Chain registry and factory for getting chain-specific signers
 */

import { ChainSigner } from '../core/types';
import { getEthereumSigner } from './ethereum';
import { getSolanaSigner } from './solana';
import { getBitcoinSigner } from './bitcoin';
import { getPolkadotSigner } from './polkadot';

/**
 * Get a chain signer for the specified blockchain
 */
export function getChainSigner(chain: string): ChainSigner {
  switch (chain) {
    // EVM chains
    case 'Ethereum':
    case 'Polygon':
    case 'Avalanche':
    case 'BSC':
      return getEthereumSigner(chain);

    // Solana
    case 'Solana':
      return getSolanaSigner();

    // Bitcoin
    case 'Bitcoin':
      return getBitcoinSigner();

    // Polkadot
    case 'Polkadot':
      return getPolkadotSigner();

    // EdDSA chains (future)
    case 'Cardano':
      throw new Error('Cardano signing not yet implemented');
    case 'NEAR':
      throw new Error('NEAR signing not yet implemented');

    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}

/**
 * Check if a chain is supported
 */
export function isChainSupported(chain: string): boolean {
  const supportedChains = [
    'Ethereum',
    'Polygon',
    'Avalanche',
    'BSC',
    'Solana',
    'Bitcoin',
    'Polkadot',
  ];
  return supportedChains.includes(chain);
}

/**
 * Get list of supported chains
 */
export function getSupportedChains(): string[] {
  return [
    'Ethereum',
    'Polygon',
    'Avalanche',
    'BSC',
    'Solana',
    'Bitcoin',
    'Polkadot',
  ];
}
