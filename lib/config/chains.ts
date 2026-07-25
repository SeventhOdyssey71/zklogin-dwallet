/**
 * Destination-chain configuration — MAINNET.
 *
 * These are the chains an Ika dWallet signs *for*. The dWallet key itself lives on Sui mainnet
 * (see lib/config/network.ts); everything here is about where the resulting signature gets
 * broadcast. Every value below moves real value.
 *
 * RPCs are public endpoints, which is fine for reads and occasional sends but will rate-limit
 * under load — override via the NEXT_PUBLIC_*_RPC_URL env vars for anything sustained.
 */

import { CHAINS } from './chainRegistry';

export interface ChainConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  blockExplorer: string;
}

/**
 * EVM + Bitcoin, derived from the chain registry.
 *
 * This used to be a hand-maintained literal and silently fell out of sync: Base, Arbitrum, Optimism,
 * Linea and Scroll were added to the registry but never here, so `fetchEVMBalance` threw
 * "Chain config not found for Base" and those balances read 0. Deriving it means adding a chain in
 * one place is enough.
 */
export const MAINNET_CHAINS: { [key: string]: ChainConfig } = Object.fromEntries(
  CHAINS.filter((c) => c.family === 'evm' || c.family === 'bitcoin').map((c) => [
    c.id,
    {
      name: c.name,
      chainId: c.chainId ?? 0,
      rpcUrl: c.rpcUrl,
      nativeCurrency: { name: c.name, symbol: c.symbol, decimals: c.decimals },
      blockExplorer: c.explorer,
    },
  ])
);

/**
 * Back-compat alias. The app was testnet-only and imported `TESTNET_CHAINS`; the old name is kept
 * pointing at mainnet so no call site silently resolves to `undefined` during the migration.
 *
 * @deprecated Use MAINNET_CHAINS.
 */
export const TESTNET_CHAINS = MAINNET_CHAINS;

/** ED25519 dWallet chains. */
export const SOLANA_MAINNET = {
  name: 'Solana',
  rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://solana-rpc.publicnode.com',
  blockExplorer: 'https://explorer.solana.com',
};

export const POLKADOT_MAINNET = {
  name: 'Polkadot Asset Hub',
  rpcUrl: process.env.NEXT_PUBLIC_POLKADOT_RPC_URL || 'wss://polkadot-asset-hub-rpc.polkadot.io',
  blockExplorer: 'https://assethub-polkadot.subscan.io',
};

/**
 * Cardano goes through Koios (not Blockfrost) — it needs no API key, which is why the app's
 * cardano-* API routes were built against it. `preview.koios.rest` was the testnet host; mainnet is
 * `api.koios.rest`. Server-side routes proxy this to dodge CORS.
 */
export const CARDANO_MAINNET = {
  name: 'Cardano',
  rpcUrl: process.env.NEXT_PUBLIC_CARDANO_API_URL || 'https://api.koios.rest/api/v1',
  blockExplorer: 'https://cardanoscan.io',
  /** Mainnet Shelley payment addresses are bech32 with the `addr1` prefix. */
  addressPrefix: 'addr1',
};

export const NEAR_MAINNET = {
  name: 'NEAR',
  rpcUrl: process.env.NEXT_PUBLIC_NEAR_RPC_URL || 'https://rpc.mainnet.near.org',
  blockExplorer: 'https://nearblocks.io',
};

// Deprecated aliases, same rationale as TESTNET_CHAINS above.
/** @deprecated Use SOLANA_MAINNET. */
export const SOLANA_TESTNET = SOLANA_MAINNET;
/** @deprecated Use POLKADOT_MAINNET. */
export const POLKADOT_TESTNET = POLKADOT_MAINNET;
/** @deprecated Use CARDANO_MAINNET. */
export const CARDANO_TESTNET = CARDANO_MAINNET;
/** @deprecated Use NEAR_MAINNET. */
export const NEAR_TESTNET = NEAR_MAINNET;

/** Explorer transaction URL per chain. */
export function txExplorerUrl(chain: string, txHash: string): string {
  switch (chain) {
    case 'Bitcoin':
      return `${MAINNET_CHAINS.Bitcoin.blockExplorer}/tx/${txHash}`;
    case 'Solana':
      return `${SOLANA_MAINNET.blockExplorer}/tx/${txHash}`;
    case 'Polkadot':
      return `${POLKADOT_MAINNET.blockExplorer}/extrinsic/${txHash}`;
    case 'Cardano':
      return `${CARDANO_MAINNET.blockExplorer}/transaction/${txHash}`;
    case 'NEAR':
      return `${NEAR_MAINNET.blockExplorer}/txns/${txHash}`;
    default:
      return `${MAINNET_CHAINS[chain]?.blockExplorer ?? 'https://etherscan.io'}/tx/${txHash}`;
  }
}
