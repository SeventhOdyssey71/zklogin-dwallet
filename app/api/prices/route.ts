/**
 * API route: live token prices (USD) + logos via CoinGecko /coins/markets.
 * Proxied server-side to avoid browser CORS and centralize caching.
 * Returns { [coingeckoId]: { usd: number, logo: string } }.
 */

import { NextResponse } from 'next/server';

const COINGECKO_IDS = [
  'ethereum',
  'matic-network',
  'avalanche-2',
  'binancecoin',
  'bitcoin',
  'solana',
  'polkadot',
  'cardano',
  'near',
];

export async function GET() {
  try {
    const url =
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${COINGECKO_IDS.join(',')}` +
      `&per_page=250&page=1&sparkline=false`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      next: { revalidate: 60 },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return NextResponse.json({ error: `CoinGecko returned ${response.status}` }, { status: 502 });
    }

    const data = (await response.json()) as Array<{ id: string; current_price: number; image: string }>;

    const out: Record<string, { usd: number; logo: string }> = {};
    for (const coin of data ?? []) {
      out[coin.id] = { usd: coin.current_price ?? 0, logo: coin.image ?? '' };
    }
    // Ensure every requested id is present.
    for (const id of COINGECKO_IDS) {
      if (!out[id]) out[id] = { usd: 0, logo: '' };
    }

    return NextResponse.json(out, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=120' },
    });
  } catch (error) {
    console.error('❌ Price fetch failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Failed to fetch prices' }, { status: 500 });
  }
}
