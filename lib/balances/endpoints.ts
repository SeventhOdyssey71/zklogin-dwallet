/**
 * RPC endpoints for balance reads, ordered by measured latency.
 *
 * HOW THIS LIST WAS BUILT
 * -----------------------
 * Every entry was probed with a browser `Origin` header and kept only if it (a) answered correctly and
 * (b) returned `Access-Control-Allow-Origin`. That second condition is the one that matters and the one
 * that is easy to get wrong: an endpoint can answer perfectly from a server yet be blocked by the
 * browser, which surfaces as a generic "fetch failed" and looks like an empty wallet rather than a
 * blocked request.
 *
 * Excluded, with the reason measured rather than assumed:
 *   1rpc.io/{arb,op,bnb,scroll}       no ACAO header on the POST response → browser-blocked
 *   1rpc.io/matic                     HTTP 429 (rate-limited even unauthenticated)
 *   1rpc.io/eth                       "Remote Error"
 *   polygon-rpc.com                   HTTP 401 (now needs a key)
 *   api.mainnet-beta.solana.com       HTTP 403 for browser origins
 *   solana.drpc.org                   HTTP 400
 *   rpc.ankr.com/solana               HTTP 403 (needs a key)
 *   scroll-mainnet.public.blastapi.io HTTP 403
 *   binance.llamarpc.com              DNS/connection failure
 *   rpc.mevblocker.io                 connection failure
 *   api.avax.network                  echoes a single specific origin, so not usable from our origin
 *
 * `rpc.mainnet.near.org` is kept only as a last resort: it answered in 3.7s against FastNEAR's 0.6s,
 * and that latency is exactly why NEAR balance reads were timing out at the old 6s budget.
 *
 * Every chain now has at least two endpoints. Previously the five L2s had exactly one each — no
 * fallback list existed for them at all — so a single slow response produced
 * "All Base RPC endpoints failed" and a zero balance.
 */

export interface EndpointSet {
  /** Ordered by measured latency; the pool walks this list and skips unhealthy hosts. */
  urls: string[];
}

/** JSON-RPC endpoints for the EVM chains, fastest first. */
export const EVM_ENDPOINTS: Record<string, string[]> = {
  Ethereum: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'],
  Base: [
    'https://base-rpc.publicnode.com',
    'https://mainnet.base.org',
    'https://1rpc.io/base',
    'https://base.drpc.org',
  ],
  Arbitrum: [
    'https://arbitrum-one-rpc.publicnode.com',
    'https://arb1.arbitrum.io/rpc',
    'https://arbitrum.drpc.org',
  ],
  Optimism: [
    'https://optimism-rpc.publicnode.com',
    'https://optimism.drpc.org',
    'https://mainnet.optimism.io',
  ],
  Polygon: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org'],
  Avalanche: ['https://avalanche-c-chain-rpc.publicnode.com', 'https://1rpc.io/avax/c'],
  BSC: ['https://bsc-dataseed.bnbchain.org', 'https://bsc-rpc.publicnode.com'],
  Linea: [
    'https://1rpc.io/linea',
    'https://linea-rpc.publicnode.com',
    'https://linea.drpc.org',
    'https://rpc.linea.build',
  ],
  // Scroll's own node measured 2.2s; drpc is consistently faster, so it leads.
  Scroll: ['https://scroll.drpc.org', 'https://rpc.scroll.io'],
};

/** Solana: only one public endpoint survives a browser origin. */
export const SOLANA_ENDPOINTS = ['https://solana-rpc.publicnode.com'];

/** NEAR, fastest first. The official endpoint is last — it measured 3.7s. */
export const NEAR_ENDPOINTS = [
  'https://free.rpc.fastnear.com',
  'https://near.drpc.org',
  'https://near.lava.build',
  'https://rpc.mainnet.near.org',
];

/** Host of a URL, used as the rate-limit and health key. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
