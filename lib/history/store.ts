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
 * WHERE IT LIVES
 * --------------
 * Redis is the source of truth, via /api/history, so history belongs to the account rather than to one
 * browser — sign in elsewhere and it follows you, clear site data and it survives. `localStorage` remains
 * the local cache because it renders instantly and keeps working offline.
 *
 * Writes go to both: locally first so the UI updates immediately, then pushed to the server. A failed push
 * is not fatal — the entry is still on this device and the next `syncFromServer` merges rather than
 * replaces, so nothing is lost by being briefly out of step.
 */

import { CHAIN_BY_ID } from '@/lib/config/chainRegistry';
import { reportTransaction } from '@/lib/account/report';

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

/**
 * Push entries to the durable store.
 *
 * Fire-and-forget: the caller has already recorded locally, so a network failure must not surface as a
 * failed send. The server merges by id, so re-sending an entry it already has is harmless.
 */
function pushToServer(entries: HistoryEntry[]): void {
  if (entries.length === 0) return;
  void fetch('/api/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  }).catch(() => {
    // Offline or signed out; the local copy stands and the next sync will merge it.
  });
}

/**
 * Pull the account's stored history and merge it with what this device holds.
 *
 * A merge, never a replace, in both directions: the server may hold entries recorded on another device,
 * and this device may hold entries whose push failed. Whichever side is missing something gets it.
 */
export async function syncFromServer(address: string): Promise<void> {
  if (!address || typeof window === 'undefined') return;
  try {
    const res = await fetch('/api/history', { cache: 'no-store' });
    if (!res.ok) return;
    const { entries } = (await res.json()) as { entries?: HistoryEntry[] };
    if (!Array.isArray(entries)) return;

    const local = readHistory(address);
    const seen = new Set(local.map((e) => e.id));
    const fromServer = entries.filter((e) => e?.id && !seen.has(e.id));
    const localOnly = local.filter((e) => !entries.some((s) => s.id === e.id));

    if (fromServer.length > 0) {
      write(address, [...local, ...fromServer].sort((a, b) => b.at - a.at));
    }
    // Anything the server has never seen — typically a push that failed while offline.
    if (localOnly.length > 0) pushToServer(localOnly);
  } catch {
    // Never let a sync failure break the view; the local ledger is still perfectly usable.
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
  const created = { ...entry, id } as HistoryEntry;
  write(address, [created, ...list]);
  pushToServer([created]);
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
  /**
   * Outside `record`, deliberately.
   *
   * `record` also handles detected receives, which are inferred from a balance rising and so have no hash
   * and no certainty about when or from whom — exactly the rows the volume table refuses. Reporting from
   * here keeps the ledger to value we know we moved. A re-render that calls this twice is harmless: the
   * server drops the second by (chain, tx_hash).
   */
  reportTransaction({
    kind: 'send',
    chain: params.chain,
    symbol: params.symbol,
    amount: params.amount,
    counterparty: params.recipient,
    txHash: params.txHash,
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
