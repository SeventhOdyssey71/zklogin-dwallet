'use client';

/**
 * Push-based deposit detection.
 *
 * Deposit latency was never an Ika problem — the app fetched balances once on mount, so an incoming
 * transfer only appeared when the user reloaded. This watches the chains in realtime and reports
 * "something may have changed on chain X"; the caller then refetches through the existing
 * `fetchBalances` path, so there is exactly one place that knows how to read a balance.
 *
 * Transport per chain family, all on free endpoints (no API keys required):
 *
 *   Solana   `accountSubscribe` over the public mainnet WebSocket. Fires on the actual account
 *            write, so a deposit surfaces at confirmation — effectively instant.
 *   EVM      `eth_subscribe("newHeads")`. A deposit cannot land without a block, so a block is the
 *            tightest correct trigger; this is event-driven rather than a fixed timer.
 *   Bitcoin  mempool.space `track-address` if the socket connects (it is origin-checked and may
 *            refuse outside a browser), otherwise polling.
 *   Others   Polkadot / Cardano / NEAR have no free realtime endpoint wired up, so they poll.
 *
 * Everything degrades to polling rather than failing: a watcher that silently stops is worse than
 * a slower one. Reconnects use capped exponential backoff so a flaky network doesn't spin.
 */

import { MAINNET_CHAINS, SOLANA_MAINNET } from '@/lib/config/chains';

export interface WatchTarget {
  chain: string;
  address: string;
}

export interface WatchOptions {
  targets: WatchTarget[];
  /** Called when `chain` may have new activity. Debounced per chain by the watcher. */
  onActivity: (chain: string) => void;
  /** Fallback poll interval for chains with no realtime transport (ms). */
  pollIntervalMs?: number;
}

/** WebSocket URLs for the EVM chains we support. */
const EVM_WSS: Record<string, string> = {
  Ethereum: 'wss://ethereum-rpc.publicnode.com',
  Polygon: 'wss://polygon-bor-rpc.publicnode.com',
  BSC: 'wss://bsc-rpc.publicnode.com',
  Avalanche: 'wss://avalanche-c-chain-rpc.publicnode.com',
};

const SOLANA_WSS =
  process.env.NEXT_PUBLIC_SOLANA_WSS_URL || SOLANA_MAINNET.rpcUrl.replace(/^http/, 'ws');

const BITCOIN_WSS = 'wss://mempool.space/api/v1/ws';

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/** Collapse a burst of events into one refetch. */
const DEBOUNCE_MS = 400;

/**
 * Minimum gap between refetches for the same chain, by how the source signals.
 *
 * This distinction matters a lot. An *address-scoped* source (Solana `accountSubscribe`, Bitcoin
 * address tracking) only fires when that account actually changed, so it should refetch immediately
 * — those events are rare and always meaningful.
 *
 * A *block-scoped* source (`eth_subscribe("newHeads")`) fires on every block whether or not anything
 * relevant happened. Across eight EVM chains with 1–2s block times that is 5–10 events per second,
 * and refetching on each one produced a continuous storm of balance requests: hundreds of duplicate
 * calls, a flooded console, and enough pressure to get rate-limited into HTTP 500s from Blockstream
 * and the Cardano proxy. Throttling to 12s keeps deposits feeling immediate while cutting the request
 * volume by ~20x.
 */
const THROTTLE_MS = { address: 0, block: 12_000 } as const;
type SourceKind = keyof typeof THROTTLE_MS;

type Cleanup = () => void;

/**
 * Start watching. Returns a cleanup function that tears down every socket and timer — call it from
 * an effect's teardown, otherwise a re-render leaks sockets.
 */
export function watchDeposits(options: WatchOptions): Cleanup {
  const { targets, onActivity, pollIntervalMs = 15_000 } = options;
  if (typeof window === 'undefined' || targets.length === 0) return () => {};

  const cleanups: Cleanup[] = [];
  let stopped = false;

  // Per-chain debounce + throttle so a stream of blocks can't turn into a stream of refetches.
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const lastFired = new Map<string, number>();

  const fire = (chain: string, kind: SourceKind) => {
    if (stopped) return;

    const minGap = THROTTLE_MS[kind];
    const since = Date.now() - (lastFired.get(chain) ?? 0);
    if (minGap > 0 && since < minGap) return; // still inside the quiet window

    const existing = timers.get(chain);
    if (existing) clearTimeout(existing);
    timers.set(
      chain,
      setTimeout(() => {
        timers.delete(chain);
        if (stopped) return;
        lastFired.set(chain, Date.now());
        onActivity(chain);
      }, DEBOUNCE_MS)
    );
  };

  cleanups.push(() => {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    lastFired.clear();
  });

  /**
   * A self-reconnecting WebSocket.
   *
   * `onOpen` re-issues the subscription on every (re)connect — a reconnected socket has no
   * server-side subscription state, so forgetting this yields a live socket that never fires.
   */
  const connect = (
    url: string,
    onOpen: (ws: WebSocket) => void,
    onMessage: (data: string, ws: WebSocket) => void,
    label: string,
    options: { maxAttempts?: number; onGiveUp?: () => void } = {}
  ): Cleanup => {
    const { maxAttempts = Infinity, onGiveUp } = options;
    let ws: WebSocket | null = null;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closedByUs = false;

    const open = () => {
      if (closedByUs || stopped) return;
      try {
        ws = new WebSocket(url);
      } catch {
        schedule();
        return;
      }
      ws.onopen = () => {
        attempt = 0;
        try {
          onOpen(ws!);
        } catch (e) {
          console.warn(`[deposits] ${label} subscribe failed`, e);
        }
      };
      ws.onmessage = (ev) => onMessage(String(ev.data), ws!);
      ws.onerror = () => {
        /* onclose follows; handled there */
      };
      ws.onclose = () => {
        if (!closedByUs) schedule();
      };
    };

    const schedule = () => {
      if (closedByUs || stopped) return;
      if (attempt >= maxAttempts) {
        // Endpoint looks permanently unavailable. Stop retrying — an unbounded loop against a dead
        // host just fills the console with "WebSocket connection failed" forever.
        closedByUs = true;
        onGiveUp?.();
        return;
      }
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt++, RECONNECT_MAX_MS);
      retry = setTimeout(open, delay);
    };

    open();
    return () => {
      closedByUs = true;
      if (retry) clearTimeout(retry);
      try {
        ws?.close();
      } catch {
        /* already gone */
      }
    };
  };

  const byChain = new Map(targets.map((t) => [t.chain, t.address]));

  // ── Solana: subscribe to the account itself ──
  const solAddress = byChain.get('Solana');
  if (solAddress) {
    let subscribed = false;
    cleanups.push(
      connect(
        SOLANA_WSS,
        (ws) => {
          subscribed = false;
          ws.send(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'accountSubscribe',
              params: [solAddress, { encoding: 'base64', commitment: 'confirmed' }],
            })
          );
        },
        (data) => {
          // First reply is the subscription id; subsequent ones are notifications.
          if (!subscribed) {
            if (data.includes('"result"')) subscribed = true;
            return;
          }
          // Address-scoped: only fires when this account actually changed.
          if (data.includes('accountNotification')) fire('Solana', 'address');
        },
        'solana'
      )
    );
  }

  // ── EVM: a block is the tightest correct trigger for a native-balance change ──
  for (const chain of Object.keys(EVM_WSS)) {
    if (!byChain.has(chain)) continue;
    let subscribed = false;
    cleanups.push(
      connect(
        EVM_WSS[chain],
        (ws) => {
          subscribed = false;
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'] }));
        },
        (data) => {
          if (!subscribed) {
            if (data.includes('"result"')) subscribed = true;
            return;
          }
          // Block-scoped: fires every block regardless of relevance, so it is throttled.
          if (data.includes('eth_subscription')) fire(chain, 'block');
        },
        chain.toLowerCase()
      )
    );
  }

  // ── Bitcoin: try mempool.space, fall back to polling if it never confirms a connection ──
  const btcAddress = byChain.get('Bitcoin');
  if (btcAddress) {
    let btcLive = false;
    let btcPolling = false;
    const startBtcPolling = () => {
      if (btcPolling || stopped) return;
      btcPolling = true;
      startPolling(['Bitcoin']);
    };

    const stopBtc = connect(
      BITCOIN_WSS,
      (ws) => {
        ws.send(JSON.stringify({ 'track-address': btcAddress }));
        btcLive = true;
      },
      (data) => {
        // mempool.space sends both address-scoped and block-scoped frames; treat the generic
        // "block" frame as block-scoped so it can't drive a refetch on every new block.
        if (data.includes('address-transactions')) fire('Bitcoin', 'address');
        else if (data.includes('block')) fire('Bitcoin', 'block');
      },
      'bitcoin',
      // Origin-checked and frequently refuses browsers. Two attempts, then poll — an unbounded
      // retry loop against a dead host just repeats "WebSocket connection failed" forever.
      { maxAttempts: 2, onGiveUp: startBtcPolling }
    );
    cleanups.push(stopBtc);
    // If the socket hasn't opened shortly, assume it's unavailable here and poll instead.
    const btcProbe = setTimeout(() => {
      if (!btcLive && !stopped) {
        console.info('[deposits] Bitcoin realtime unavailable — polling instead');
        startBtcPolling();
      }
    }, 5_000);
    cleanups.push(() => clearTimeout(btcProbe));
  }

  // ── Chains with no realtime transport wired up ──
  const polled = targets
    .map((t) => t.chain)
    .filter((c) => c !== 'Solana' && c !== 'Bitcoin' && !(c in EVM_WSS));

  startPolling(polled);

  function startPolling(chains: string[]) {
    if (chains.length === 0) return;
    const id = setInterval(() => {
      if (stopped) return;
      // Polling is already rate-limited by its own interval, so bypass the block throttle.
      for (const c of chains) fire(c, 'address');
    }, pollIntervalMs);
    cleanups.push(() => clearInterval(id));
  }

  return () => {
    stopped = true;
    for (const c of cleanups) {
      try {
        c();
      } catch {
        /* keep tearing down the rest */
      }
    }
  };
}

/** Chains this watcher can observe in realtime (vs. poll). Useful for honest UI copy. */
export function realtimeChains(): string[] {
  return ['Solana', 'Bitcoin', ...Object.keys(EVM_WSS)].filter(
    (c) => c === 'Solana' || c === 'Bitcoin' || c in MAINNET_CHAINS
  );
}
