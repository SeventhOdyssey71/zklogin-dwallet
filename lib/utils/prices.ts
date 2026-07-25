/**
 * Live gas-token prices + chain logos, for every chain in the registry.
 *
 * Backed by /api/chain-assets, which combines CoinGecko's asset-platform logos with coin-market prices.
 * This used to hit a separate /api/prices endpoint that hardcoded nine CoinGecko ids, so every chain added
 * since (Base, Arbitrum, Optimism, Linea, Scroll) silently priced at $0. Driving both prices and logos from
 * the registry means adding a chain can't leave a hole here.
 *
 * CACHING, AND WHY THE OLD CACHE MADE THINGS WORSE
 * -----------------------------------------------
 * The previous version cached successes forever and failures not at all — the exact opposite of what you
 * want. A success meant USD values froze for the whole session, so a wallet left open showed prices from
 * whenever it loaded. A failure meant every subsequent balance read retried the fetch, which is why one
 * unreachable endpoint produced a dozen identical "Chain assets fetch failed" lines per refresh.
 *
 * Now: successes expire, failures are remembered briefly with backoff, and either way a balance read gets
 * an answer immediately rather than waiting on the network.
 */

import type { ChainAsset } from '@/components/ChainChips';

export interface TokenMarket {
  price: number;
  logo: string;
}

/** Prices move slowly enough that a minute is plenty, and it keeps a long session honest. */
const TTL_MS = 60_000;

/** After a failure, wait this long before trying again — doubling, capped. */
const FAILURE_BACKOFF_MS = { base: 15_000, max: 120_000 } as const;

type Assets = Record<string, ChainAsset>;

let cache: { data: Assets; at: number } | null = null;
let inflight: Promise<Assets> | null = null;
let retryAfter = 0;
let backoff: number = FAILURE_BACKOFF_MS.base;
let loggedFailureAt = 0;

async function loadAssets(): Promise<Assets> {
  const now = Date.now();

  // Serve a fresh cache without touching the network.
  if (cache && now - cache.at < TTL_MS) return cache.data;

  // Inside a failure backoff: return whatever we have (possibly stale, possibly empty) rather than
  // hammering an endpoint that just failed. Stale prices beat a request storm.
  if (now < retryAfter) return cache?.data ?? {};

  if (!inflight) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    inflight = fetch('/api/chain-assets', { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`chain-assets returned ${r.status}`);
        return r.json() as Promise<Assets>;
      })
      .then((data) => {
        cache = { data, at: Date.now() };
        retryAfter = 0;
        backoff = FAILURE_BACKOFF_MS.base;
        return data;
      })
      .catch((e) => {
        retryAfter = Date.now() + backoff;
        backoff = Math.min(FAILURE_BACKOFF_MS.max, backoff * 2);
        // One line per backoff window, not one per caller.
        if (Date.now() - loggedFailureAt > FAILURE_BACKOFF_MS.base) {
          loggedFailureAt = Date.now();
          console.warn(
            `[prices] chain-assets unavailable (${e instanceof Error ? e.message : e}); ` +
              `showing ${cache ? 'cached' : 'no'} prices, retrying in ${Math.round(backoff / 2000)}s`
          );
        }
        // Keep serving the last good data if we have it — balances stay priced across a blip.
        return cache?.data ?? {};
      })
      .finally(() => {
        clearTimeout(timer);
        inflight = null;
      });
  }
  return inflight;
}

/** Price + logo keyed by app chain id, e.g. { Solana: { price, logo }, … }. */
export async function fetchTokenMarkets(): Promise<Record<string, TokenMarket>> {
  const assets = await loadAssets();
  const out: Record<string, TokenMarket> = {};
  for (const [chain, a] of Object.entries(assets)) {
    out[chain] = { price: a.price, logo: a.logo };
  }
  return out;
}

/** Prices-only map (used when pricing balances). */
export async function fetchTokenPrices(): Promise<Record<string, number>> {
  const assets = await loadAssets();
  const out: Record<string, number> = {};
  for (const [chain, a] of Object.entries(assets)) out[chain] = a.price;
  return out;
}
