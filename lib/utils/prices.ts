/**
 * Live token price + logo helpers. Data comes from /api/prices (CoinGecko proxy).
 * Testnet tokens are valued at the real asset's market price for display.
 */

export const CHAIN_TO_COINGECKO_ID: Record<string, string> = {
  Ethereum: 'ethereum',
  Polygon: 'matic-network',
  Avalanche: 'avalanche-2',
  BSC: 'binancecoin',
  Bitcoin: 'bitcoin',
  Solana: 'solana',
  Polkadot: 'polkadot',
  Cardano: 'cardano',
  NEAR: 'near',
};

export interface TokenMarket {
  price: number;
  logo: string;
}

/** Fetch USD price + logo keyed by app chain name, e.g. { Solana: { price, logo }, ... }. */
export async function fetchTokenMarkets(): Promise<Record<string, TokenMarket>> {
  const result: Record<string, TokenMarket> = {};
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const response = await fetch('/api/prices', { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`prices API returned ${response.status}`);

    const data = (await response.json()) as Record<string, { usd: number; logo: string }>;
    for (const [chain, id] of Object.entries(CHAIN_TO_COINGECKO_ID)) {
      result[chain] = { price: data[id]?.usd ?? 0, logo: data[id]?.logo ?? '' };
    }
    return result;
  } catch (error) {
    console.error('❌ Token markets fetch failed:', error instanceof Error ? error.message : error);
    for (const chain of Object.keys(CHAIN_TO_COINGECKO_ID)) result[chain] = { price: 0, logo: '' };
    return result;
  }
}

/** Prices-only map (used by fetchBalances to compute usdValue). */
export async function fetchTokenPrices(): Promise<Record<string, number>> {
  const markets = await fetchTokenMarkets();
  const prices: Record<string, number> = {};
  for (const [chain, m] of Object.entries(markets)) prices[chain] = m.price;
  return prices;
}
