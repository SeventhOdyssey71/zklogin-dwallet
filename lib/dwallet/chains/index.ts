/**
 * Chain registry and factory for getting chain-specific signers.
 *
 * The EVM branch is resolved from `CHAIN_BY_ID[chain].family === 'evm'` rather than a hand-written
 * list. That list had drifted: it named four chains while the app offered nine EVM chains, so Base,
 * Arbitrum, Optimism, Linea and Scroll were selectable, fundable and displayed with balances — and then
 * threw "Unsupported chain" the moment you tried to send. Deriving from the single registry means
 * adding a chain there makes it sendable, instead of half-working.
 */

import { ChainSigner } from '../core/types';
import { CHAIN_BY_ID, CHAINS } from '../../config/chainRegistry';
import { getEthereumSigner } from './ethereum';
import { getSolanaSigner } from './solana';
import { getBitcoinSigner } from './bitcoin';
import { getPolkadotSigner } from './polkadot';
import { getCardanoSigner } from './cardano';
import { getNearSigner } from './near';

/** Non-EVM chains, each with its own signer implementation. */
const NON_EVM_SIGNERS: Record<string, () => ChainSigner> = {
  Solana: getSolanaSigner,
  Bitcoin: getBitcoinSigner,
  Polkadot: getPolkadotSigner,
  Cardano: getCardanoSigner,
  NEAR: getNearSigner,
};

/**
 * Get a chain signer for the specified blockchain.
 *
 * Every EVM chain shares one implementation — they differ only in chain ID, RPC and fee policy, all of
 * which the signer reads from config.
 */
export function getChainSigner(chain: string): ChainSigner {
  const def = CHAIN_BY_ID[chain];
  if (def?.family === 'evm') return getEthereumSigner(chain);

  const nonEvm = NON_EVM_SIGNERS[chain];
  if (nonEvm) return nonEvm();

  throw new Error(`Unsupported chain: ${chain}. Supported: ${getSupportedChains().join(', ')}`);
}

/** Whether a chain can actually be sent from. */
export function isChainSupported(chain: string): boolean {
  return CHAIN_BY_ID[chain]?.family === 'evm' || chain in NON_EVM_SIGNERS;
}

/**
 * Every chain that can be sent from.
 *
 * Derived, so it cannot fall out of step with what `getChainSigner` actually handles — the previous
 * hardcoded copy of this list was how the five L2s came to be offered without working.
 */
export function getSupportedChains(): string[] {
  return CHAINS.filter((c) => c.family === 'evm' || c.id in NON_EVM_SIGNERS).map((c) => c.id);
}
