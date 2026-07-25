'use client';

/**
 * The wallet's record of what moved, and when.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 * --------------------------------
 * This is the wallet's own ledger, not a chain indexer. That distinction is worth being blunt about,
 * because the two look the same until they disagree:
 *
 *   Sends      complete and exact. We built and broadcast them, so we know the chain, amount,
 *              recipient and hash with certainty the moment they go out.
 *   Receives   detected, not indexed. A deposit is recorded when a tracked balance rises, which the
 *              balance store notices from its realtime watchers and its 30-second poll. So a deposit
 *              that lands while the wallet is open is captured; one that lands while it is closed is
 *              reflected in the balance but has no dated entry.
 *
 * Indexing real inbound history across fourteen chains is not something the client can do honestly:
 * Bitcoin, Solana and Cardano expose free address history, but every EVM chain needs a keyed indexer
 * (Etherscan and friends), as do NEAR and Polkadot. Rather than show complete history on three chains
 * and silence on eleven, receives are labelled as detected and the limitation is stated in the UI.
 *
 * Stored per address in `localStorage`: it must outlive a tab (a history that forgets on refresh is not
 * a history), and it is not secret — every entry is public on chain.
 */

import { CHAIN_BY_ID } from '@/lib/config/chainRegistry';

export type EntryKind = 'send' | 'receive';

export interface HistoryEntry {
  /** Stable id, so re-recording the same transaction cannot duplicate it. */
  id: string;
  kind: EntryKind;
  chain: string;
  symbol: string;
  /** Decimal amount, as displayed. */
  amount: string;
  /** Recipient for a send; absent for a detected receive, whose sender we do not know. */
  counterparty?: string;
  /** Transaction hash, when we have one. Detected receives have none. */
  txHash?: string;
  /** Epoch ms. */
  at: number;
  /** True when this came from a balance increase rather than a transaction we made. */
  detected?: boolean;
}

/** Cap per address, so a long-lived wallet cannot grow storage without bound. */
const MAX_ENTRIES = 500;

const CACHE_VERSION = 'v1';
const keyFor = (address: string) => `zk.history.${CACHE_VERSION}.${address}`;

const listeners = new Set<() => void>();
/** Mirrors storage so reads during render are synchronous and cheap. */
const memory = new Map<string, HistoryEntry[]>();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const l of listeners) l();
}

/** Every entry for an address, newest first. */
export function readHistory(address: string): HistoryEntry[] {
  if (!address) return [];
  const cached = memory.get(address);
  if (cached) return cached;
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(keyFor(address));
    const parsed = raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
    const list = Array.isArray(parsed) ? parsed : [];
    memory.set(address, list);
    return list;
  } catch {
    return [];
  }
}

function write(address: string, list: HistoryEntry[]): void {
  const capped = list.slice(0, MAX_ENTRIES);
  memory.set(address, capped);
  try {
    window.localStorage.setItem(keyFor(address), JSON.stringify(capped));
  } catch {
    // Quota exceeded: the in-memory copy still serves this session.
  }
  emit();
}

/**
 * Record an entry.
 *
 * Ignores a duplicate id, so a component that re-renders or a watcher that fires twice cannot produce
 * two rows for one transaction.
 */
export function record(address: string, entry: Omit<HistoryEntry, 'id'> & { id?: string }): void {
  if (!address || typeof window === 'undefined') return;
  const id =
    entry.id ??
    (entry.txHash
      ? `${entry.chain}:${entry.txHash}`
      : `${entry.chain}:${entry.kind}:${entry.at}:${entry.amount}`);

  const list = readHistory(address);
  if (list.some((e) => e.id === id)) return;
  write(address, [{ ...entry, id }, ...list]);
}

/** Record a send we just broadcast. */
export function recordSend(params: {
  address: string;
  chain: string;
  symbol: string;
  amount: string;
  recipient: string;
  txHash: string;
}): void {
  record(params.address, {
    kind: 'send',
    chain: params.chain,
    symbol: params.symbol,
    amount: params.amount,
    counterparty: params.recipient,
    txHash: params.txHash,
    at: Date.now(),
  });
}

/**
 * Record a deposit inferred from a balance increase.
 *
 * Deliberately marked `detected`: we know an amount arrived and roughly when we noticed, but not who
 * sent it or in which transaction, and the UI should not imply otherwise.
 */
export function recordDetectedReceive(params: {
  address: string;
  chain: string;
  amount: string;
}): void {
  const symbol = CHAIN_BY_ID[params.chain]?.symbol ?? params.chain;
  record(params.address, {
    kind: 'receive',
    chain: params.chain,
    symbol,
    amount: params.amount,
    at: Date.now(),
    detected: true,
  });
}

/** Remove an address's history — used on sign-out. */
export function clearHistory(address?: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (address) {
      window.localStorage.removeItem(keyFor(address));
      memory.delete(address);
    } else {
      const doomed: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k?.startsWith('zk.history.')) doomed.push(k);
      }
      for (const k of doomed) window.localStorage.removeItem(k);
      memory.clear();
    }
  } catch {
    /* storage unavailable */
  }
  emit();
}
