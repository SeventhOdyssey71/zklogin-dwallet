'use client';

/**
 * Chain chips: a small [logo · LABEL] pill per supported chain, wrapped inside a card.
 *
 * Replaces the dot-separated wall of text ("Bitcoin · Ethereum · Base · …"), which got unreadable
 * once each curve covered a dozen chains and gave no visual anchor to scan by.
 *
 * Three details worth knowing:
 *
 *  • Logos are the CHAIN's, not the gas token's. Base, Arbitrum, Optimism, Linea and Scroll all pay
 *    gas in ETH, so token logos would render five identical Ethereum icons — the chain logo is the
 *    only thing that tells them apart.
 *
 *  • Labels follow suit. Defaulting to the gas symbol would print "ETH" six times, which is
 *    unreadable even with distinct logos, so those chains carry a `chipLabel` (BASE, ARB, OP, …).
 *    The tooltip always gives the full chain name plus the gas token you actually need to fund.
 *
 *  • Every logo sits on a light disc. Several official marks are solid black (Algorand's especially)
 *    and would be invisible against this dark theme; the disc guarantees contrast regardless of what
 *    CoinGecko serves, and keeps every chip visually uniform.
 */

import { useEffect, useState } from 'react';
import { CHAINS, type ChainDef } from '@/lib/config/chainRegistry';

export interface ChainAsset {
  logo: string;
  symbol: string;
  price: number;
}

/** Module-level cache: the chips render in three cards, but this should fetch once per page. */
let assetCache: Record<string, ChainAsset> | null = null;
let assetInflight: Promise<Record<string, ChainAsset>> | null = null;

async function loadChainAssets(): Promise<Record<string, ChainAsset>> {
  if (assetCache) return assetCache;
  if (!assetInflight) {
    assetInflight = fetch('/api/chain-assets')
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, ChainAsset>) => {
        assetCache = data;
        return data;
      })
      .catch(() => ({}) as Record<string, ChainAsset>)
      .finally(() => {
        assetInflight = null;
      });
  }
  return assetInflight;
}

export function useChainAssets() {
  const [assets, setAssets] = useState<Record<string, ChainAsset>>(assetCache ?? {});

  useEffect(() => {
    let cancelled = false;
    void loadChainAssets().then((a) => {
      if (!cancelled) setAssets(a);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return assets;
}

/** One chip. `dimmed` marks receive-only chains so the card doesn't overstate what it can do. */
export function ChainChip({
  chain,
  asset,
  dimmed = false,
}: {
  chain: ChainDef;
  asset?: ChainAsset;
  dimmed?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const logo = asset?.logo;
  const symbol = asset?.symbol || chain.symbol;
  // Chain-level label: distinguishes Base/ARB/OP/Linea/Scroll, which all pay gas in ETH.
  const label = chain.chipLabel || symbol;

  return (
    <span
      title={
        `${chain.name} · ${symbol}` +
        (chain.capabilities.send ? '' : ' · receive only (send not yet implemented)')
      }
      className={`inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-[11px] leading-none whitespace-nowrap transition-opacity ${
        dimmed ? 'opacity-55' : ''
      }`}
    >
      {/* Light disc keeps solid-black marks (Algorand) visible on a dark card. */}
      <span className="w-4 h-4 rounded-full bg-white/90 grid place-items-center overflow-hidden shrink-0">
        {logo && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt=""
            width={16}
            height={16}
            loading="lazy"
            onError={() => setBroken(true)}
            className="w-4 h-4 object-contain"
          />
        ) : (
          <span className="text-[8px] font-bold text-black">{label.slice(0, 2)}</span>
        )}
      </span>
      <span className="font-medium tracking-tight">{label}</span>
    </span>
  );
}

/** All chips for one curve. */
export function ChainChipGroup({
  curve,
  assets,
}: {
  curve: ChainDef['curve'];
  assets: Record<string, ChainAsset>;
}) {
  const chains = CHAINS.filter((c) => c.curve === curve);
  return (
    <div className="flex flex-wrap gap-1.5">
      {chains.map((c) => (
        <ChainChip key={c.id} chain={c} asset={assets[c.id]} />
      ))}
    </div>
  );
}

/**
 * Every supported chain in one block, in registry display order.
 *
 * The curve a chain happens to sign with is an implementation detail — from the outside these are
 * simply the chains the wallet covers, so they read as one set rather than being split across three
 * boxes labelled with curve names.
 *
 * Chips are grouped into explicit rows (5 / 5 / 4 for 14 chains) rather than left to `flex-wrap`.
 * Wrapping packs greedily, which put 12 on the first line and stranded 2 on a second — balanced rows
 * read as a deliberate grid instead. Each row still wraps internally, so on a phone the same markup
 * degrades to however many fit per line.
 */
function chunkRows<T>(items: T[], sizes: number[]): T[][] {
  const rows: T[][] = [];
  let i = 0;
  for (const size of sizes) {
    if (i >= items.length) break;
    rows.push(items.slice(i, i + size));
    i += size;
  }
  // Anything left over (a chain was added without updating `sizes`) goes in a final row rather than
  // being silently dropped.
  if (i < items.length) rows.push(items.slice(i));
  return rows;
}

export function AllChainChips({
  assets,
  rowSizes = [5, 5, 4],
  className = '',
}: {
  assets: Record<string, ChainAsset>;
  /** Chips per row, largest-first. Defaults to 5/5/4 for the current 14 chains. */
  rowSizes?: number[];
  className?: string;
}) {
  const rows = chunkRows(CHAINS, rowSizes);
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {rows.map((row, i) => (
        // `w-full` matters: without it the row sizes to its content, so `flex-wrap` never has a
        // constraint to wrap against and five chips push past a phone's viewport instead of reflowing.
        <div key={i} className="w-full flex flex-wrap justify-center gap-2">
          {row.map((c) => (
            <ChainChip key={c.id} chain={c} asset={assets[c.id]} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Total supported chains. */
export function chainCount(): number {
  return CHAINS.length;
}

/** How many chains a curve covers, and how many of those can send. */
export function curveCoverage(curve: ChainDef['curve']): { total: number; sendable: number } {
  const chains = CHAINS.filter((c) => c.curve === curve);
  return { total: chains.length, sendable: chains.filter((c) => c.capabilities.send).length };
}
