'use client';

/**
 * The network layer for balance reads: rate-limited, health-aware, and quiet.
 *
 * WHAT WENT WRONG BEFORE
 * ----------------------
 * The failures in the console were self-inflicted, not endpoint outages. Probing every endpoint directly
 * showed all of them answering in 0.4–0.9s. What broke was the *calling pattern*:
 *
 *   - Nine EVM chains were read at once, each opening its own connection with a 6s deadline.
 *   - The deposit watcher fired on every new block, so a fresh full sweep started before the previous
 *     one had finished.
 *   - Nothing was cached or shared, so two components asking for the same balance made two requests, and
 *     React's development double-mount doubled that again.
 *
 * The result was dozens of simultaneous requests against a handful of hosts. Browsers cap concurrent
 * connections per host, so requests queued, blew the 6s timeout, and reported "All Base RPC endpoints
 * failed" — for an endpoint that was perfectly healthy and simply hadn't been given a turn. Adding more
 * endpoints would not have fixed it; the fix is to stop stampeding.
 *
 * WHAT THIS DOES
 * --------------
 *   Token bucket per host   a host is never asked for more than it comfortably serves.
 *   Global concurrency cap  bounds total in-flight requests across all hosts.
 *   Circuit breaker         an endpoint that genuinely fails is skipped for a cooling-off period
 *                           instead of being retried on every sweep.
 *   Deduplicated logging    one line per endpoint per failure window, not one per attempt. The old code
 *                           printed the same five lines four times per refresh.
 */

import { hostOf } from './endpoints';

/* ----------------------------- tuning ----------------------------- */

/**
 * Sustained requests per second per host, and the burst it may absorb.
 *
 * Deliberately modest: a full sweep is 14 chains, and at 4/s a cold sweep finishes in well under a
 * second of scheduling while staying far below any public endpoint's published limit.
 */
const RATE = { perSecond: 4, burst: 8 } as const;

/** Maximum in-flight requests across all hosts. Browsers cap ~6 per host; this bounds the total. */
const MAX_CONCURRENT = 6;

/** Per-attempt deadline. Generous because rate limiting means we are no longer racing ourselves. */
const TIMEOUT_MS = 9_000;

/** Consecutive failures before an endpoint is taken out of rotation. */
const FAILURES_TO_OPEN = 3;

/** Cooling-off period, doubling per repeat, capped. */
const COOLDOWN_MS = { base: 30_000, max: 300_000 } as const;

/** Minimum gap between identical log lines. */
const LOG_QUIET_MS = 60_000;

/* --------------------------- rate limiting -------------------------- */

interface Bucket {
  tokens: number;
  last: number;
}
const buckets = new Map<string, Bucket>();

/** Wait until this host has a token available, then consume it. */
async function takeToken(host: string): Promise<void> {
  for (;;) {
    const now = Date.now();
    const bucket = buckets.get(host) ?? { tokens: RATE.burst, last: now };
    // Refill continuously rather than on a timer: no interval to leak, and no drift.
    const refill = ((now - bucket.last) / 1000) * RATE.perSecond;
    bucket.tokens = Math.min(RATE.burst, bucket.tokens + refill);
    bucket.last = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      buckets.set(host, bucket);
      return;
    }
    buckets.set(host, bucket);
    // Sleep exactly as long as the next token needs, plus jitter so parallel callers don't sync up.
    const waitMs = ((1 - bucket.tokens) / RATE.perSecond) * 1000;
    await sleep(waitMs + Math.random() * 60);
  }
}

/* --------------------------- concurrency --------------------------- */

let active = 0;
const waiting: (() => void)[] = [];

async function acquireSlot(): Promise<() => void> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active--;
    waiting.shift()?.();
  };
}

/* ------------------------- endpoint health ------------------------- */

interface Health {
  failures: number;
  /** Timestamp before which this endpoint is skipped. */
  openUntil: number;
  /** How long the current cooldown is, doubling per repeated failure. */
  cooldown: number;
}
const health = new Map<string, Health>();

const healthOf = (url: string): Health =>
  health.get(url) ?? { failures: 0, openUntil: 0, cooldown: COOLDOWN_MS.base };

/** Whether this endpoint may be tried right now. */
function isUsable(url: string): boolean {
  return healthOf(url).openUntil <= Date.now();
}

function recordSuccess(url: string): void {
  // A success fully resets the endpoint: half-open recovery, no lingering penalty.
  if (health.has(url)) health.delete(url);
}

function recordFailure(url: string): void {
  const h = healthOf(url);
  h.failures += 1;
  if (h.failures >= FAILURES_TO_OPEN) {
    h.openUntil = Date.now() + h.cooldown;
    quiet(
      `endpoint:${url}`,
      `[balances] ${hostOf(url)} is failing — skipping it for ${Math.round(h.cooldown / 1000)}s`
    );
    h.cooldown = Math.min(COOLDOWN_MS.max, h.cooldown * 2);
    h.failures = 0;
  }
  health.set(url, h);
}

/* --------------------------- quiet logging -------------------------- */

const lastLogged = new Map<string, number>();

/** Log at most once per `LOG_QUIET_MS` for a given key. */
export function quiet(key: string, message: string, level: 'warn' | 'error' = 'warn'): void {
  const now = Date.now();
  if ((lastLogged.get(key) ?? 0) + LOG_QUIET_MS > now) return;
  lastLogged.set(key, now);
  if (level === 'error') console.error(message);
  else console.warn(message);
}

/* ------------------------------ core ------------------------------ */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class RpcError extends Error {}

/** One rate-limited, time-boxed request. */
async function requestOnce(url: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  await takeToken(hostOf(url));
  const release = await acquireSlot();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // Honour an outer abort (component unmount) without confusing it for a timeout.
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener('abort', onOuterAbort);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new RpcError(`HTTP ${res.status}`);
    const json = (await res.json()) as { error?: { message?: string }; result?: unknown };
    // Some hosts return an error body with HTTP 200, so the status alone is not enough.
    if (json.error) throw new RpcError(json.error.message ?? 'rpc error');
    return json.result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
    release();
  }
}

/**
 * Call a JSON-RPC method, trying each endpoint in turn.
 *
 * Endpoints in a cooling-off period are skipped. If every endpoint is either unhealthy or fails, the
 * healthiest is still attempted once rather than failing without trying — a wallet showing a stale
 * balance is better than one showing zero because a breaker happened to be open.
 */
export async function callRpc(
  label: string,
  urls: string[],
  body: unknown,
  signal?: AbortSignal
): Promise<unknown> {
  const usable = urls.filter(isUsable);
  const order = usable.length > 0 ? usable : urls.slice(0, 1);
  let lastError = 'no endpoints configured';

  for (const url of order) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const result = await requestOnce(url, body, signal);
      recordSuccess(url);
      return result;
    } catch (e) {
      // An outer abort is not an endpoint fault; don't penalise the endpoint for it.
      if (signal?.aborted) throw e;
      const err = e as Error;
      lastError = `${hostOf(url)}: ${err.name === 'AbortError' ? 'timeout' : err.message}`;
      recordFailure(url);
    }
  }

  throw new RpcError(`${label} unavailable (${lastError})`);
}

/** Snapshot of endpoint health, for diagnostics. */
export function rpcHealth(): { url: string; openForMs: number }[] {
  const now = Date.now();
  return [...health.entries()]
    .filter(([, h]) => h.openUntil > now)
    .map(([url, h]) => ({ url, openForMs: h.openUntil - now }));
}
