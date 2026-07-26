'use client';

/**
 * Dashboard vocabulary: the shapes the caller fills in, and the three formatters every part shares.
 *
 * The types live here rather than in `DashboardOverview` so the sub-parts can name them without
 * importing back into the module that composes them — a cycle that type-only imports survive but which
 * makes the dependency direction read backwards.
 *
 * The formatters are module-level and allocation-free per call for a reason: fourteen cards re-render on
 * every balance tick, and `new Intl.NumberFormat()` inside a render body is one of the few genuinely
 * expensive things you can do by accident in React.
 */

import { useSyncExternalStore } from 'react';

export interface DashboardChain {
  chain: string;
  symbol: string;
  /** URL; '' when unavailable — the card falls back to the first three characters of the symbol. */
  logo: string;
  /** Formatted native balance, e.g. "0.023630". undefined = not loaded yet. */
  balance?: string;
  /** USD value. undefined = not loaded yet. */
  usdValue?: number;
  /** Set when the last read failed; the shown balance is stale. */
  stale?: boolean;
}

export interface DashboardActivity {
  id: string;
  kind: 'send' | 'receive';
  chain: string;
  symbol: string;
  amount: string;
  at: number;
  txHash?: string;
  explorerUrl?: string;
  /** Receives inferred from a balance change, not indexed — so no counterparty and no hash. */
  detected?: boolean;
}

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * A USD figure, or an em dash if the number isn't one.
 *
 * Dust is clamped to "<$0.01" instead of rounding to "$0.00": a chain holding a real, spendable amount
 * should not print the same string as an empty one. NaN/Infinity reach here whenever a price feed
 * returns garbage, and "$NaN" in a wallet destroys trust faster than a missing number does.
 */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value > 0 && value < 0.01) return '<$0.01';
  return USD.format(value);
}

/**
 * Drop trailing zeros from an already-formatted decimal string.
 *
 * Balances arrive at full native precision ("0.000000" for an empty chain, "0.023630" for a funded
 * one). Printing that verbatim makes every empty chain look like a measurement rather than a zero, and
 * makes the funded ones harder to compare at a glance. This is deliberately string surgery — parsing to
 * a Number would round away the tail of an 18-decimal balance.
 */
export function trimAmount(amount: string): string {
  if (!amount.includes('.')) return amount;
  const trimmed = amount.replace(/0+$/, '').replace(/\.$/, '');
  // "0.000000" trims to "0", but "-0.000000" would trim to "-0" and "" is possible for ".000".
  return trimmed === '' || trimmed === '-' ? '0' : trimmed;
}

/**
 * "just now" / "12s ago" / "4m ago" / "3h ago" / "2d ago".
 *
 * Floored rather than rounded at every boundary, so nothing ever reads "60s ago" or "24h ago". `now` is
 * a parameter so the whole list shares one clock reading — computing `Date.now()` per row lets two
 * entries a millisecond apart straddle a boundary and disagree about what time it is.
 */
export function relativeTime(at: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ---------------------------- one shared clock ---------------------------- */

/**
 * A single ticking clock for the whole app, exposed as an external store.
 *
 * Ageing a relative timestamp needs *something* to re-render, and the obvious `setInterval` + `setState`
 * in whichever component owns the list is the wrong something: it re-renders that component's entire
 * subtree once a second, forever, purely to change the word "2m" to "3m". This app has already been
 * burnt by that — a ticking parent elsewhere made text inputs feel like they were catching keystrokes.
 *
 * So the timer lives here, outside React, and is read through `useSyncExternalStore` by leaf components
 * that render nothing but the string. A tick re-renders those leaves and nothing above them. One timer
 * serves every subscriber, and it stops entirely when the last one unmounts, so a dashboard left open in
 * a background tab isn't holding a live interval for a screen nobody is reading.
 *
 * Ten seconds is the cadence because the finest label this produces is second-granularity only under a
 * minute; beyond that a sharper tick would compute identical strings.
 */
const CLOCK_INTERVAL_MS = 10_000;

// Seeded at module load rather than at first subscribe, so the very first paint shows real ages instead
// of a frame of "just now" on entries that are hours old.
let clockNow = Date.now();
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;

function subscribeClock(onChange: () => void): () => void {
  clockListeners.add(onChange);
  if (clockTimer === null) {
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      for (const listener of clockListeners) listener();
    }, CLOCK_INTERVAL_MS);
  }
  return () => {
    clockListeners.delete(onChange);
    if (clockListeners.size === 0 && clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

// Must be a cached value, not a fresh `Date.now()`: `useSyncExternalStore` compares snapshots by
// identity and would loop forever on a reading that changes every call.
const clockSnapshot = () => clockNow;

/**
 * The current time, refreshed on the shared tick.
 *
 * Call this only from a component that renders a timestamp and nothing else — the whole point is that a
 * tick re-renders as little as possible.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribeClock, clockSnapshot, clockSnapshot);
}
