/**
 * Chain logos + gas-token prices for every chain in the registry.
 *
 * Two CoinGecko endpoints are combined because they answer different questions:
 *
 *   /asset_platforms  → the CHAIN's logo. This is the important one: Base, Arbitrum, Optimism, Linea
 *                       and Scroll all burn ETH for gas, so keying logos off the gas token would
 *                       render five identical Ethereum icons. The platform logo is what actually
 *                       distinguishes them.
 *   /coins/markets    → the gas token's symbol and USD price.
 *
 * Bitcoin has no asset-platform entry (it isn't a smart-contract chain), so it falls back to its
 * coin image. Proxied server-side for CORS, and cached — CoinGecko's free tier rate-limits hard, and
 * chain logos essentially never change.
 */

import { NextResponse } from 'next/server';
import { CHAINS, coingeckoCoinIds, coingeckoPlatformIds } from '@/lib/config/chainRegistry';

export const revalidate = 300;

interface AssetPlatform {
  id: string;
  image?: { large?: string; small?: string; thumb?: string } | null;
}

interface MarketCoin {
  id: string;
  symbol: string;
  current_price: number | null;
  image: string | null;
}

export interface ChainAsset {
  /** Chain logo URL ('' if unavailable — the client renders a lettered fallback). */
  logo: string;
  /** Gas-token symbol, uppercased. */
  symbol: string;
  /** Gas-token USD price (0 if unavailable). */
  price: number;
}

async function timed<T>(url: string, ms = 10_000): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      next: { revalidate },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function GET() {
  const coinIds = coingeckoCoinIds();
  const platformIds = new Set(coingeckoPlatformIds());

  const [platforms, markets] = await Promise.all([
    timed<AssetPlatform[]>('https://api.coingecko.com/api/v3/asset_platforms'),
    timed<MarketCoin[]>(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coinIds.join(',')}&per_page=250&page=1&sparkline=false`
    ),
  ]);

  const platformLogo = new Map<string, string>();
  for (const p of platforms ?? []) {
    if (!platformIds.has(p.id)) continue;
    const img = p.image?.large || p.image?.small || p.image?.thumb || '';
    if (img) platformLogo.set(p.id, img);
  }

  const coinInfo = new Map<string, { symbol: string; price: number; image: string }>();
  for (const c of markets ?? []) {
    coinInfo.set(c.id, {
      symbol: (c.symbol ?? '').toUpperCase(),
      price: c.current_price ?? 0,
      image: c.image ?? '',
    });
  }

  const out: Record<string, ChainAsset> = {};
  for (const chain of CHAINS) {
    const coin = chain.coingeckoCoinId ? coinInfo.get(chain.coingeckoCoinId) : undefined;
    const platform = chain.coingeckoPlatformId
      ? platformLogo.get(chain.coingeckoPlatformId)
      : undefined;

    out[chain.id] = {
      // Chain logo first, gas-token image as fallback (this is Bitcoin's path).
      logo: platform || coin?.image || '',
      // Prefer the registry's symbol: it's authoritative for display and already correct
      // (e.g. Polygon shows POL, not the coin id's legacy MATIC).
      symbol: chain.symbol || coin?.symbol || chain.id.slice(0, 4).toUpperCase(),
      price: coin?.price ?? 0,
    };
  }

  return NextResponse.json(out, {
    headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=900' },
  });
}
