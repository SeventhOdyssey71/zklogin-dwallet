/**
 * RPC endpoints for balance reads: two to three per chain, from different operators.
 *
 * HOW THESE WERE CHOSEN
 * ---------------------
 * Every candidate was probed three times with a browser `Origin`, and kept only if all three attempts
 * succeeded AND the response carried `Access-Control-Allow-Origin`. That second condition is the one that
 * bites: an endpoint can answer perfectly from a server and still be blocked by the browser, which
 * surfaces as a generic "fetch failed" and looks like an empty wallet rather than a blocked request.
 * Order within each chain is by measured median latency.
 *
 * WHY OPERATORS ARE MIXED
 * -----------------------
 * The previous list had publicnode first on almost every chain. That is a correlated failure: when
 * publicnode rate-limited one user's IP, six chains reported ERR_CONNECTION_CLOSED at the same moment and
 * the circuit breaker had to trip separately for each. Every chain now has at least two distinct
 * operators, so one provider throttling an IP degrades rather than blanks the wallet.
 *
 * Rejected, with the measured reason rather than an assumption:
 *   *.blockpi.network                 HTTP 402/503 on the public tier
 *   1rpc.io/{arb,op,bnb,matic}        no ACAO header, or 429
 *   polygon-rpc.com                   HTTP 401 (now needs a key)
 *   api.mainnet-beta.solana.com       HTTP 403 for browser origins (proxied instead — see below)
 *   rpc.ankr.com/*                    HTTP 403 without a key
 *   solana.drpc.org                   HTTP 400
 *   endpoints.omniatech.io/*          HTTP 521
 *   1rpc.io/near                      does not implement the `query` method
 *   eth.llamarpc.com, extrnode, …     do not resolve
 */

/** JSON-RPC endpoints for the EVM chains, fastest first, operators mixed. */
export const EVM_ENDPOINTS: Record<string, string[]> = {
  Ethereum: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'],
  Base: [
    'https://base-rpc.publicnode.com',
    'https://mainnet.base.org',
    'https://base.drpc.org',
  ],
  Arbitrum: ['https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc'],
  Optimism: [
    // Optimism's own node measured fastest here, which also gets publicnode off the front of one more chain.
    'https://mainnet.optimism.io',
    'https://optimism-rpc.publicnode.com',
    'https://optimism.drpc.org',
  ],
  Polygon: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org'],
  Avalanche: [
    'https://avalanche.drpc.org',
    'https://avalanche-c-chain-rpc.publicnode.com',
    'https://1rpc.io/avax/c',
  ],
  BSC: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org'],
  Linea: [
    'https://linea-rpc.publicnode.com',
    'https://rpc.linea.build',
    'https://1rpc.io/linea',
  ],
  Scroll: ['https://rpc.scroll.io', 'https://scroll.drpc.org', 'https://1rpc.io/scroll'],
};

/**
 * Solana: one direct endpoint plus our own proxy.
 *
 * Solana is the only chain with a single viable browser-facing free endpoint — every alternative refuses a
 * browser Origin. `/api/solana-rpc` forwards server-side, where those same endpoints answer fine, so this
 * list is two genuinely independent paths rather than one. The direct endpoint leads because it avoids the
 * extra hop; the proxy takes over when it rate-limits.
 */
export const SOLANA_ENDPOINTS = ['https://solana-rpc.publicnode.com', '/api/solana-rpc'];

/**
 * NEAR, fastest first.
 *
 * All five of these pass. The official `rpc.mainnet.near.org` is last: it measured 4.1s against
 * near.drpc.org's 0.26s, and that latency is exactly why NEAR reads were timing out when it led the list.
 */
export const NEAR_ENDPOINTS = [
  'https://near.drpc.org',
  'https://free.rpc.fastnear.com',
  'https://rpc.mainnet.fastnear.com',
  'https://near.lava.build',
  'https://rpc.mainnet.near.org',
];

/** Host of a URL, used as the rate-limit and health key. A relative path is its own bucket. */
export function hostOf(url: string): string {
  if (url.startsWith('/')) return 'self';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
