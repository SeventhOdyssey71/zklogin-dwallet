/**
 * Chain registry — the single source of truth for every chain a dWallet can address.
 *
 * A dWallet key is chain-agnostic: it is just a keypair on a curve, held in shares across the Ika
 * network. What makes it "an Ethereum wallet" or "a Solana wallet" is nothing more than (a) how you
 * encode the public key into an address and (b) how you serialize and hash a transaction. So a
 * single secp256k1 dWallet already controls every EVM chain plus Bitcoin, and a single ed25519
 * dWallet already controls Solana, NEAR and Cardano — with no additional DKG, no extra IKA spend,
 * and no new key material.
 *
 * EVERY CHAIN HERE IS FULLY ROUND-TRIP. Money can be sent in *and* taken back out: address
 * derivation, balance reading, and transaction building/signing/broadcasting all work. Chains that
 * could only receive (Tron, the Cosmos zones, Aptos, Stellar, Algorand — where deriving the address
 * is trivial but building their transactions is per-chain work not yet done) are deliberately absent
 * rather than listed as half-supported. `capabilities.send` is kept on the type so a future chain
 * can be staged, but nothing in this registry ships with it false.
 */

/** Which Ika curve a chain's signatures come from. */
export type CurveKind = 'ECDSA' | 'EdDSA' | 'Schnorrkel' | 'ECDSA-R1';

/** How to encode the public key, and how to read balances. */
export type ChainFamily =
  | 'evm'
  | 'bitcoin'
  | 'solana'
  | 'substrate'
  | 'cardano'
  | 'near'
  | 'tron'
  | 'cosmos'
  | 'aptos'
  | 'stellar'
  | 'algorand';

export interface ChainDef {
  /** Stable key used across the app (UI, balances, signers). */
  id: string;
  name: string;
  curve: CurveKind;
  family: ChainFamily;
  symbol: string;
  decimals: number;
  /** EVM chain id — also the EIP-155 replay-protection value folded into the signature. */
  chainId?: number;
  rpcUrl: string;
  explorer: string;
  /** bech32 human-readable part, for Cosmos zones. */
  bech32Prefix?: string;
  /**
   * Short label for the chain chips. Defaults to `symbol`, which reads correctly for chains whose
   * token *is* their identity (BTC, SOL, ATOM). It is overridden for the ETH-gas L2s: six chips all
   * labelled "ETH" would be indistinguishable even with different logos, so those show the chain
   * instead. The tooltip always carries the full name plus the gas token.
   */
  chipLabel?: string;
  capabilities: {
    /** Address derivation + balance reading work. */
    receive: boolean;
    /** This app can build, sign and broadcast a transfer. */
    send: boolean;
  };
  /**
   * CoinGecko *asset platform* id — used for the CHAIN's logo, which is what distinguishes Base from
   * Arbitrum from Linea even though all three burn ETH for gas. Bitcoin has no platform entry (it is
   * not a smart-contract chain), so it falls back to `coingeckoCoinId`.
   */
  coingeckoPlatformId?: string;
  /** CoinGecko coin id for the chain's GAS token — drives the symbol and USD price. */
  coingeckoCoinId?: string;
  /** Circle CCTP V1 domain, where the chain participates. */
  cctpDomain?: number;
  /** Native USDC contract/coin identifier, for CCTP routes. */
  usdc?: string;
}

const env = (k: string, fallback: string) => process.env[k] || fallback;

/**
 * Every EVM chain shares one secp256k1 address, so adding an L2 costs a config entry — the signer,
 * address derivation and balance reader are already generic. Chain id and RPC are the only inputs.
 */
const EVM: ChainDef[] = [
  {
    id: 'Ethereum',
    name: 'Ethereum',
    curve: 'ECDSA',
    family: 'evm',
    symbol: 'ETH',
    decimals: 18,
    chainId: 1,
    rpcUrl: env('NEXT_PUBLIC_ETHEREUM_RPC_URL', 'https://ethereum-rpc.publicnode.com'),
    explorer: 'https://etherscan.io',
    coingeckoPlatformId: 'ethereum',
    coingeckoCoinId: 'ethereum',
    capabilities: { receive: true, send: true },
    cctpDomain: 0,
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  {
    id: 'Base',
    name: 'Base',
    curve: 'ECDSA',
    family: 'evm',
    symbol: 'ETH',
    decimals: 18,
    chainId: 8453,
    rpcUrl: env('NEXT_PUBLIC_BASE_RPC_URL', 'https://base-rpc.publicnode.com'),
    explorer: 'https://basescan.org',
    chipLabel: 'BASE',
    coingeckoPlatformId: 'base',
    coingeckoCoinId: 'ethereum',
    capabilities: { receive: true, send: true },
    cctpDomain: 6,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  {
    id: 'Arbitrum',
    name: 'Arbitrum One',
    curve: 'ECDSA',
    family: 'evm',
    symbol: 'ETH',
    decimals: 18,
    chainId: 42161,
    rpcUrl: env('NEXT_PUBLIC_ARBITRUM_RPC_URL', 'https://arbitrum-one-rpc.publicnode.com'),
    explorer: 'https://arbiscan.io',
    chipLabel: 'ARB',
    coingeckoPlatformId: 'arbitrum-one',
    coingeckoCoinId: 'ethereum',
    capabilities: { receive: true, send: true },
    cctpDomain: 3,
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },
  {
    id: 'Optimism',
    name: 'OP Mainnet',
    curve: 'ECDSA',
    family: 'evm',
    symbol: 'ETH',
    decimals: 18,
    chainId: 10,
    rpcUrl: env('NEXT_PUBLIC_OPTIMISM_RPC_URL', 'https://optimism-rpc.publicnode.com'),
    explorer: 'https://optimistic.etherscan.io',
    chipLabel: 'OP',
    coingeckoPlatformId: 'optimistic-ethereum',
    coingeckoCoinId: 'ethereum',
    capabilities: { receive: true, send: true },
    cctpDomain: 2,
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  },
  {
    id: 'Polygon',
    name: 'Polygon',
    curve: 'ECDSA',
    family: 'evm',
    symbol: 'POL',
    decimals: 18,
    chainId: 137,
    rpcUrl: env('NEXT_PUBLIC_POLYGON_RPC_URL', 'https://polygon-bor-rpc.publicnode.com'),
    explorer: 'https://polygonscan.com',
    coingeckoPlatformId: 'polygon-pos',
    coingeckoCoinId: 'polygon-ecosystem-token',
    capabilities: { receive: true, send: true },
    cctpDomain: 7,
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  },
  {
    id: 'Avalanche',
    name: 'Avalanche C-Chain',
    curve: 'ECDSA',
    family: 'evm',
    symbol: 'AVAX',
    decimals: 18,
    chainId: 43114,
    rpcUrl: env('NEXT_PUBLIC_AVALANCHE_RPC_URL', 'https://api.avax.network/ext/bc/C/rpc'),
    explorer: 'https://snowtrace.io',
    coingeckoPlatformId: 'avalanche',
    coingeckoCoinId: 'avalanche-2',
    capabilities: { receive: true, send: true },
    cctpDomain: 1,
    usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  },
  {
    id: 'BSC',
    name: 'BNB Smart Chain',
    curve: 'ECDSA',
    family: 'evm',
    symbol: 'BNB',
    decimals: 18,
    chainId: 56,
    rpcUrl: env('NEXT_PUBLIC_BSC_RPC_URL', 'https://bsc-rpc.publicnode.com'),
    explorer: 'https://bscscan.com',
    // BSC is NOT a CCTP chain — no cctpDomain, so the pipeline will refuse it rather than
    // silently building a burn that can never be minted.
    coingeckoPlatformId: 'binance-smart-chain',
    coingeckoCoinId: 'binancecoin',
    capabilities: { receive: true, send: true },
  },
  {
    id: 'Linea',
    name: 'Linea',
    curve: 'ECDSA',
    family: 'evm',
    symbol: 'ETH',
    decimals: 18,
    chainId: 59144,
    rpcUrl: env('NEXT_PUBLIC_LINEA_RPC_URL', 'https://linea-rpc.publicnode.com'),
    explorer: 'https://lineascan.build',
    chipLabel: 'LINEA',
    coingeckoPlatformId: 'linea',
    coingeckoCoinId: 'ethereum',
    capabilities: { receive: true, send: true },
  },
  {
    id: 'Scroll',
    name: 'Scroll',
    curve: 'ECDSA',
    family: 'evm',
    symbol: 'ETH',
    decimals: 18,
    chainId: 534352,
    rpcUrl: env('NEXT_PUBLIC_SCROLL_RPC_URL', 'https://rpc.scroll.io'),
    explorer: 'https://scrollscan.com',
    chipLabel: 'SCROLL',
    coingeckoPlatformId: 'scroll',
    coingeckoCoinId: 'ethereum',
    capabilities: { receive: true, send: true },
  },
];

/** secp256k1, non-EVM. */
const SECP_OTHER: ChainDef[] = [
  {
    id: 'Bitcoin',
    name: 'Bitcoin',
    curve: 'ECDSA', // signed with Taproot/BIP340 — see lib/dwallet/chains/bitcoin.ts
    family: 'bitcoin',
    symbol: 'BTC',
    decimals: 8,
    rpcUrl: env('NEXT_PUBLIC_BITCOIN_API_URL', 'https://blockstream.info/api'),
    explorer: 'https://blockstream.info',
    coingeckoCoinId: 'bitcoin',
    capabilities: { receive: true, send: true },
  },
];

/** ed25519. */
const ED25519: ChainDef[] = [
  {
    id: 'Solana',
    name: 'Solana',
    curve: 'EdDSA',
    family: 'solana',
    symbol: 'SOL',
    decimals: 9,
    // NOT api.mainnet-beta.solana.com: it passes CORS preflight but answers the actual POST with
    // HTTP 403 "Access forbidden" from a browser origin, so balances silently read as 0. Its
    // WebSocket still works, but the HTTP endpoint is unusable here.
    rpcUrl: env('NEXT_PUBLIC_SOLANA_RPC_URL', 'https://solana-rpc.publicnode.com'),
    explorer: 'https://explorer.solana.com',
    coingeckoPlatformId: 'solana',
    coingeckoCoinId: 'solana',
    capabilities: { receive: true, send: true },
    cctpDomain: 5,
    usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  },
  {
    id: 'NEAR',
    name: 'NEAR',
    curve: 'EdDSA',
    family: 'near',
    symbol: 'NEAR',
    decimals: 24,
    rpcUrl: env('NEXT_PUBLIC_NEAR_RPC_URL', 'https://rpc.mainnet.near.org'),
    explorer: 'https://nearblocks.io',
    coingeckoPlatformId: 'near-protocol',
    coingeckoCoinId: 'near',
    capabilities: { receive: true, send: true },
  },
  {
    id: 'Cardano',
    name: 'Cardano',
    curve: 'EdDSA',
    family: 'cardano',
    symbol: 'ADA',
    decimals: 6,
    rpcUrl: env('NEXT_PUBLIC_CARDANO_API_URL', 'https://api.koios.rest/api/v1'),
    explorer: 'https://cardanoscan.io',
    coingeckoPlatformId: 'cardano',
    coingeckoCoinId: 'cardano',
    capabilities: { receive: true, send: true },
  },
];

/**
 * Polkadot appears twice by design.
 *
 * Its native scheme is sr25519 = Ika's `SchnorrkelSubstrate` on the RISTRETTO curve. Substrate also
 * accepts ed25519 accounts, which is what the app used before RISTRETTO was wired up — so the
 * ed25519 variant stays for anyone whose funds already sit at that address, while `Polkadot` proper
 * now uses the native curve. Both are valid on-chain; they are simply different accounts.
 */
/**
 * Substrate is intentionally empty.
 *
 * Polkadot was removed because it could not sign: its Schnorrkel/ristretto share fails
 * `decryptUserShare` with "Invalid signature", thrown before any protocol parameter is used, because
 * `generateDeterministicEncryptionSeed` maps RISTRETTO to the string 'ed25519' — a seed-derivation
 * mismatch of ours. Listing a chain that can receive but never send is worse than not listing it, and
 * the fix changes derived keys, so it needs its own decision about the existing dWallet.
 *
 * Removing it also removes the only ristretto chain, so onboarding no longer pays for a third DKG, and
 * `@polkadot/api` (875 KB) leaves the client bundle.
 */
const SUBSTRATE: ChainDef[] = [];

export const CHAINS: ChainDef[] = [...EVM, ...SECP_OTHER, ...ED25519, ...SUBSTRATE];

export const CHAIN_BY_ID: Record<string, ChainDef> = Object.fromEntries(
  CHAINS.map((c) => [c.id, c])
);

export function chainsForCurve(curve: CurveKind): ChainDef[] {
  return CHAINS.filter((c) => c.curve === curve);
}

export function isEvm(chainId: string): boolean {
  return CHAIN_BY_ID[chainId]?.family === 'evm';
}

/** CoinGecko asset-platform ids we need logos for. */
export function coingeckoPlatformIds(): string[] {
  return [...new Set(CHAINS.map((c) => c.coingeckoPlatformId).filter(Boolean) as string[])];
}

/** CoinGecko coin ids we need prices/symbols for. */
export function coingeckoCoinIds(): string[] {
  return [...new Set(CHAINS.map((c) => c.coingeckoCoinId).filter(Boolean) as string[])];
}

/** Chains that can originate a CCTP transfer to Sui. */
export function cctpSourceChains(): ChainDef[] {
  return CHAINS.filter((c) => c.cctpDomain !== undefined && c.usdc);
}

/** Explorer URL for a transaction. */
export function txUrl(chainId: string, txHash: string): string {
  const c = CHAIN_BY_ID[chainId];
  if (!c) return '';
  switch (c.family) {
    case 'substrate':
      return `${c.explorer}/extrinsic/${txHash}`;
    case 'cardano':
      return `${c.explorer}/transaction/${txHash}`;
    case 'near':
      return `${c.explorer}/txns/${txHash}`;
    case 'cosmos':
      return `${c.explorer}/tx/${txHash}`;
    case 'aptos':
      return `${c.explorer}/txn/${txHash}?network=mainnet`;
    case 'stellar':
      return `${c.explorer}/tx/${txHash}`;
    case 'algorand':
      return `${c.explorer}/tx/${txHash}`;
    case 'tron':
      return `${c.explorer}/transaction/${txHash}`;
    default:
      return `${c.explorer}/tx/${txHash}`;
  }
}

/** Explorer URL for an address. */
export function addressUrl(chainId: string, address: string): string {
  const c = CHAIN_BY_ID[chainId];
  if (!c) return '';
  switch (c.family) {
    case 'substrate':
      return `${c.explorer}/account/${address}`;
    case 'cardano':
      return `${c.explorer}/address/${address}`;
    case 'near':
      return `${c.explorer}/address/${address}`;
    case 'cosmos':
      return `${c.explorer}/address/${address}`;
    case 'aptos':
      return `${c.explorer}/account/${address}?network=mainnet`;
    case 'stellar':
      return `${c.explorer}/account/${address}`;
    case 'algorand':
      return `${c.explorer}/address/${address}`;
    case 'tron':
      return `${c.explorer}/address/${address}`;
    case 'bitcoin':
      return `${c.explorer}/address/${address}`;
    default:
      return `${c.explorer}/address/${address}`;
  }
}
