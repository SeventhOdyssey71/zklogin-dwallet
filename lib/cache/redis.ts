import "server-only";

/**
 * The app's shared Redis cache.
 *
 * One connection, one place that knows how to degrade. Anything server-side that wants a cache that
 * outlives the process — the zkLogin proof, CoinGecko prices and logos — goes through here rather than
 * keeping its own module-level map and its own idea of what to do when Redis is missing.
 *
 * REDIS IS ALWAYS OPTIONAL
 * ------------------------
 * With no `REDIS_URL`, an unfilled password, or an unreachable server, every function here behaves as a
 * cache miss and the caller falls back to its in-memory copy. A cache is an optimisation; losing it must
 * never break a request. Failures are logged once per process, not per call, because the previous
 * per-call logging is exactly what turned one bad endpoint into a wall of console noise.
 */

import type Redis from "ioredis";

/**
 * Hang the client off `globalThis`.
 *
 * A module-level value is discarded whenever this module is re-evaluated — every Fast Refresh in
 * development — which would silently open a new Redis connection each time and lose the cache it exists
 * to preserve.
 */
const g = globalThis as typeof globalThis & {
  __appRedis?: Redis | null;
  __appRedisWarned?: boolean;
};

function warnOnce(message: string): void {
  if (g.__appRedisWarned) return;
  g.__appRedisWarned = true;
  console.warn(`[redis] ${message} — continuing without a shared cache.`);
}

/**
 * Whether the URL is actually usable.
 *
 * The example URL ships with an empty password so it can be filled in, and an unreplaced placeholder is a
 * half-finished config rather than a broken one. Either way, treat it as "no Redis" instead of failing
 * every request while someone is still editing the file.
 */
function isConfigured(url: string | undefined): url is string {
  if (!url) return false;
  if (url.includes("<PASSWORD>") || url.includes("PASSWORD@")) return false;
  try {
    const parsed = new URL(url);
    // `redis://default:@host` — a blank password means it hasn't been filled in yet.
    if (parsed.username && !parsed.password) return false;
    return true;
  } catch {
    return false;
  }
}

/** The shared client, or null when Redis isn't configured or couldn't be created. */
export function redis(): Redis | null {
  if (g.__appRedis !== undefined) return g.__appRedis;

  const url = process.env.REDIS_URL;
  if (!isConfigured(url)) {
    g.__appRedis = null;
    return null;
  }

  try {
    // Required at call time so a deployment without Redis never loads the driver at all.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const IORedis = require("ioredis") as typeof import("ioredis").default;
    const client = new IORedis(url, {
      /**
       * The offline queue must stay ENABLED.
       *
       * Disabling it looks like the safe "fail fast" choice, but the client connects asynchronously, so
       * the first command after startup is issued before the socket is writeable and dies with
       * "Stream isn't writeable and enableOfflineQueue options is false" — making every cold start miss
       * the cache, which is the one case Redis was added to fix. Failing fast comes from the timeouts
       * below instead, so an unreachable server costs a bounded delay and then falls back.
       */
      connectTimeout: 8_000,
      commandTimeout: 5_000,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: true,
      lazyConnect: false,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 500, 2_000)),
    });
    client.on("error", (e: Error) => warnOnce(`error: ${e.message}`));
    g.__appRedis = client;
    return client;
  } catch (e) {
    warnOnce(`could not initialise: ${(e as Error).message}`);
    g.__appRedis = null;
    return null;
  }
}

/** True when a shared cache is active. */
export function redisEnabled(): boolean {
  return redis() !== null;
}

/** Read and parse a JSON value, or null on a miss or any failure. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = redis();
  if (!client) return null;
  try {
    const raw = await client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (e) {
    warnOnce(`read failed: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Write a JSON value with a TTL.
 *
 * Write-behind by default: the caller already has the value, so a slow or failed write must never delay
 * the response it belongs to.
 */
export function cacheSet(key: string, value: unknown, ttlSeconds: number): void {
  const client = redis();
  if (!client) return;
  void client
    .set(key, JSON.stringify(value), "EX", ttlSeconds)
    .catch((e: Error) => warnOnce(`write failed: ${e.message}`));
}

/** Round-trip the server, for diagnostics. Null when Redis isn't configured. */
export async function cachePing(): Promise<{ ok: boolean; detail: string } | null> {
  const client = redis();
  if (!client) return null;
  try {
    const started = Date.now();
    const pong = await client.ping();
    return { ok: pong === "PONG", detail: `${pong} in ${Date.now() - started}ms` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
