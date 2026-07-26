'use client';

/**
 * One place that owns balances: cached, coalesced, and polled on a schedule.
 *
 * Before this, every component that wanted a balance called a fetcher directly. Nothing was shared, so
 * two views showing the same chain made two requests; the deposit watcher triggered a full sweep on every
 * new block; and React's development double-mount doubled it all again. That request storm — not any
 * endpoint being down — is what produced the wall of failures in the console.
 *
 * The rules here are deliberately boring:
 *
 *   Coalesce   one in-flight request per (chain, address). Concurrent askers share it.
 *   Cache      a value newer than FRESH_MS is served as-is, with no network call.
 *   Poll       every POLL_MS, and only while the tab is visible.
 *   Force      a manual refresh bypasses the cache but still respects the rate limiter.
 *
 * Polling stops when the tab is hidden and catches up on return. A wallet left open in a background tab
 * was previously making thousands of pointless requests an hour, which is how the rate limits were hit in
 * the first place.
 */

import { fetchChainBalance, type Balance } from './fetchers';
import { recordDetectedReceive } from '@/lib/history/store';

/** How long a cached balance is considered current. */
const FRESH_MS = 25_000;

/** Idle refresh cadence — roughly twice a minute, as intended. */
export const POLL_MS = 30_000;

/** After a send or a detected deposit, the chain is refetched this soon rather than waiting a full poll. */
const SETTLE_MS = 2_500;

export interface Entry extends Balance {
  /** When this value was fetched. 0 means never. */
  at: number;
  /** True while a request for this key is in flight. */
  loading: boolean;
  /** Last error for this key, if the most recent attempt failed. */
  error?: string;
}

interface Target {
  chain: string;
  address: string;
  /** Ika curve number, which decides how the chain is read. */
  curve: number;
}

/**
 * The zkLogin address that owns the tracked chains, so detected deposits are filed under the right user.
 *
 * Set by the view that registers targets; history is per account, and without it a deposit would have
 * nowhere to go.
 */
let ledgerOwner = '';

export function setHistoryOwner(address: string): void {
  ledgerOwner = address;
}

const key = (chain: string, address: string) => `${chain}:${address}`;

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();
const targets = new Map<string, Target>();
const listeners = new Set<() => void>();

let pollTimer: ReturnType<typeof setInterval> | null = null;
let visibilityBound = false;

/** Subscribe to store changes. Returns an unsubscribe function. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Notify subscribers, coalescing bursts into one render.
 *
 * A poll touches fourteen chains and each `read` emits twice — once when it starts, once when it settles
 * — so a single refresh fired ~28 notifications. They arrive from separate promise callbacks, so React
 * cannot batch them automatically, and each one re-rendered the chain list. Collapsing them into one
 * frame turns a visible stutter into a single update, which matters most while someone is typing in the
 * send dialog.
 */
let emitScheduled = false;

function emit(): void {
  if (emitScheduled) return;
  emitScheduled = true;
  const flush = () => {
    emitScheduled = false;
    for (const l of listeners) l();
  };
  // A frame is the right granularity: nothing visual can happen sooner, and it guarantees a flush even
  // in a background tab where rAF is paused.
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
  else setTimeout(flush, 16);
}

/** Current value for a chain, or undefined if never fetched. */
export function peek(chain: string, address: string): Entry | undefined {
  return cache.get(key(chain, address));
}

/** Everything currently known, keyed by chain. */
export function snapshot(): Record<string, Entry> {
  const out: Record<string, Entry> = {};
  for (const [k, v] of cache) out[k.split(':')[0]] = v;
  return out;
}

/** The freshest timestamp across all tracked chains, for an "updated Xs ago" indicator. */
export function lastUpdated(): number {
  let newest = 0;
  for (const v of cache.values()) if (v.at > newest) newest = v.at;
  return newest;
}

/** True while any tracked chain is being fetched. */
export function isBusy(): boolean {
  return inflight.size > 0;
}

/**
 * Register the chains to keep up to date.
 *
 * Replaces the previous set, so navigating between wallets stops polling the ones you left. Calling this
 * with the same targets is cheap and idempotent — it is safe to call from a render effect.
 */
export function setTargets(next: Target[]): void {
  const wanted = new Set(next.map((t) => key(t.chain, t.address)));

  for (const k of [...targets.keys()]) if (!wanted.has(k)) targets.delete(k);
  for (const t of next) targets.set(key(t.chain, t.address), t);

  ensurePolling();
}

/**
 * Read a balance, from cache when it is fresh enough.
 *
 * `force` skips the freshness check — used by the refresh button and after a send — but still goes through
 * coalescing and the rate limiter, so mashing refresh cannot produce a storm.
 */
export function read(target: Target, options: { force?: boolean } = {}): Promise<Entry> {
  const k = key(target.chain, target.address);

  const existing = inflight.get(k);
  if (existing) return existing;

  const cached = cache.get(k);
  if (!options.force && cached && Date.now() - cached.at < FRESH_MS) {
    return Promise.resolve(cached);
  }

  // Mark loading without discarding the previous value: the UI keeps showing the last known balance
  // while a refresh runs, rather than flashing back to a skeleton or a zero.
  cache.set(k, {
    balance: cached?.balance ?? '0',
    usdValue: cached?.usdValue ?? 0,
    at: cached?.at ?? 0,
    loading: true,
    error: cached?.error,
  });
  emit();

  const job = (async (): Promise<Entry> => {
    try {
      const value = await fetchChainBalance(target.chain, target.address, target.curve);
      const entry: Entry = { ...value, at: Date.now(), loading: false };

      /**
       * A balance that went up is a deposit.
       *
       * This is the only place that sees the previous and the new value together, which makes it the
       * honest place to notice one. Requires a prior *successful* read (`at > 0`): on a first load there
       * is nothing to compare against, and treating the initial balance as an incoming transfer would
       * invent history that never happened.
       */
      const prior = cached;
      if (prior?.at && ledgerOwner) {
        const before = parseFloat(prior.balance) || 0;
        const after = parseFloat(entry.balance) || 0;
        if (after > before) {
          recordDetectedReceive({
            address: ledgerOwner,
            chain: target.chain,
            amount: formatDelta(after - before),
          });
        }
      }

      cache.set(k, entry);
      return entry;
    } catch (e) {
      /**
       * Keep the last good value on failure.
       *
       * Overwriting a real balance with 0 because one request failed is actively misleading in a wallet —
       * it reads as "your funds are gone". The stale value plus an error marker is honest.
       */
      const prior = cache.get(k);
      const entry: Entry = {
        balance: prior?.at ? prior.balance : '0',
        usdValue: prior?.at ? prior.usdValue : 0,
        at: prior?.at ?? 0,
        loading: false,
        error: (e as Error).message,
      };
      cache.set(k, entry);
      return entry;
    } finally {
      inflight.delete(k);
      emit();
    }
  })();

  inflight.set(k, job);
  return job;
}

/** Refresh every registered chain. Returns when all have settled. */
export async function refreshAll(options: { force?: boolean } = {}): Promise<void> {
  const list = [...targets.values()];
  if (list.length === 0) return;
  // The rate limiter bounds real concurrency, so requesting all of them at once is safe and simply lets
  // the fastest chains render first.
  await Promise.all(list.map((t) => read(t, options).catch(() => undefined)));
}

/**
 * Refresh one chain shortly after something changed it.
 *
 * The delay exists because a node that has just accepted a transaction often serves the pre-transaction
 * balance for a moment; refetching instantly tends to return the old number and look broken.
 */
export function refreshSoon(chain: string): void {
  const found = [...targets.values()].find((t) => t.chain === chain);
  if (!found) return;
  setTimeout(() => void read(found, { force: true }).catch(() => undefined), SETTLE_MS);
}

/* ----------------------------- polling ----------------------------- */

function ensurePolling(): void {
  if (typeof window === 'undefined') return;

  if (!visibilityBound) {
    visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        // Catch up immediately on return, then resume the normal cadence.
        void refreshAll();
        ensurePolling();
      } else {
        stopPolling();
      }
    });
  }

  if (targets.size === 0) {
    stopPolling();
    return;
  }
  if (pollTimer || document.visibilityState !== 'visible') return;

  pollTimer = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    void refreshAll();
  }, POLL_MS);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * Format a balance delta for display.
 *
 * Floating-point subtraction of two decimal strings leaves artefacts like 0.30000000000000004, so the
 * result is rounded to the precision the fetchers actually report and then trimmed.
 */
function formatDelta(delta: number): string {
  return String(Number(delta.toFixed(8)));
}

/** Drop everything — used on sign-out so one user's balances never appear for the next. */
export function clearBalances(): void {
  cache.clear();
  inflight.clear();
  targets.clear();
  ledgerOwner = '';
  stopPolling();
  emit();
}
