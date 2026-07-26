'use client';

/**
 * React binding for the balance store.
 *
 * `useSyncExternalStore` is the right primitive here rather than local state: the store is shared by every
 * view, and this guarantees a component never renders a value that is already out of date (the tearing
 * problem you get from mirroring an external source into `useState`).
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  isBusy,
  lastUpdated,
  peek,
  read,
  refreshAll,
  setTargets,
  subscribe,
  POLL_MS,
  type Entry,
} from './store';

export interface BalanceTarget {
  chain: string;
  address: string;
  curve: number;
}

export interface UseBalancesResult {
  /** Balance by chain. Missing means never fetched. */
  balances: Record<string, Entry | undefined>;
  /** True while any tracked chain is in flight. */
  busy: boolean;
  /** Epoch ms of the newest value, or 0. */
  updatedAt: number;
  /** Force a refresh of every tracked chain. */
  refresh: () => Promise<void>;
}

export function useBalances(targets: BalanceTarget[]): UseBalancesResult {
  // Stable identity for the target list, so an inline array in the caller doesn't re-register every render.
  const signature = targets.map((t) => `${t.chain}:${t.address}:${t.curve}`).join('|');

  const version = useSyncExternalStore(
    subscribe,
    // A counter would be ideal, but the store has no version; the newest timestamp plus in-flight count
    // changes on every meaningful transition, which is exactly when a re-render is warranted.
    () => `${lastUpdated()}:${isBusy()}`,
    () => '0:false'
  );

  useEffect(() => {
    if (targets.length === 0) return;
    setTargets(targets);
    // Kick off an immediate read; anything already fresh is served from cache without a request.
    void Promise.all(targets.map((t) => read(t).catch(() => undefined)));
    // `signature` captures the meaningful content of `targets`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const balances = useMemo(() => {
    const out: Record<string, Entry | undefined> = {};
    for (const t of targets) out[t.chain] = peek(t.chain, t.address);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, version]);

  const refresh = useCallback(() => refreshAll({ force: true }), []);

  return {
    balances,
    busy: isBusy(),
    updatedAt: lastUpdated(),
    refresh,
  };
}

/**
 * "updated 12s ago", ticking once a second.
 *
 * IMPORTANT: call this from a LEAF component that renders nothing but the label. It sets state every
 * second, so calling it from a view that renders a list re-renders that entire list at 1Hz — which is
 * how the send dialog's inputs came to feel like they were catching while being typed into. See
 * `UpdatedAgo` in app/page.tsx for the intended shape.
 */
export function useAgeLabel(updatedAt: number): string {
  /**
   * The clock is held in state rather than read during render.
   *
   * `Date.now()` in a render body makes the render impure: the same props produce a different result each
   * time, which React is free to call more than once and to discard. Ticking a stored timestamp keeps the
   * render a pure function of its inputs, and the label still updates once a second because the tick is
   * what re-renders it.
   */
  const [now, setNow] = useState(updatedAt);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timer.current = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  if (!updatedAt) return 'never';
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? '1 min ago' : `${minutes} min ago`;
}

/** The idle refresh cadence, for UI copy. */
export const REFRESH_SECONDS = Math.round(POLL_MS / 1000);
