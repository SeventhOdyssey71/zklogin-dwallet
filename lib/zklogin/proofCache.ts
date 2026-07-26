import "server-only";

/**
 * Where the zkLogin Groth16 proof is cached.
 *
 * WHY CACHE IT AT ALL
 * -------------------
 * The proof costs ~2-4s to mint and Shinami rate-limits it to roughly two per minute per address. It
 * depends only on (ephemeral public key, maxEpoch, salt) — never on the transaction — so one proof serves
 * every transaction for the whole 48-hour session. Only the cheap ephemeral signature changes per tx.
 *
 * WHY REDIS
 * ---------
 * The in-memory cache is correct but per-process. It is discarded on every cold start and not shared
 * between instances, so the first send after a deploy or a scale-up pays the full mint again — and in
 * development it was being wiped by every Fast Refresh, which looked like network latency rather than a
 * lost cache. Redis makes the cache outlive the process and be shared across instances.
 *
 * DEGRADING CLEANLY
 * -----------------
 * Redis is optional. With no `REDIS_URL`, or if the server is unreachable, this falls back to the
 * in-memory map and the app behaves exactly as before — a cache is an optimisation, and losing it must
 * never break signing. Connection failures are logged once, not per request.
 *
 * WHAT IS STORED
 * --------------
 * The proof and address seed only: no JWT, no salt, no private key. The proof is a zero-knowledge
 * artefact that is already sent to the chain with every transaction, so it is not a secret. It is keyed by
 * a SHA-256 of (ephemeral pubkey, maxEpoch, salt) rather than the raw values, so the salt never appears in
 * a Redis key, and given a TTL so nothing outlives the session it belongs to.
 */

import { createHash } from "node:crypto";
import type Redis from "ioredis";

/**
 * Generic over the proof payload so the cache stays decoupled from the prover's exact types while the
 * caller keeps full type safety — no cast at the call site, which is where a wrong shape would silently
 * produce an invalid signature.
 */
export interface CachedProof<P = unknown> {
  proofCore: P;
  addressSeed: string;
}

/** Never outlive the session the proof belongs to. */
const TTL_SECONDS = 48 * 60 * 60;

const PREFIX = "zk:proof:";

/**
 * Hang the client and the in-memory fallback off `globalThis`.
 *
 * A plain module-level value is discarded whenever this module is re-evaluated, which in development
 * happens on every Fast Refresh — reintroducing the exact cold-cache problem this file exists to solve,
 * and opening a new Redis connection each time.
 */
const g = globalThis as typeof globalThis & {
  __zkProofMemory?: Map<string, Promise<CachedProof<unknown>>>;
  __zkRedis?: Redis | null;
  __zkRedisWarned?: boolean;
};

const memory: Map<string, Promise<CachedProof<unknown>>> = (g.__zkProofMemory ??= new Map());

function warnOnce(message: string): void {
  if (g.__zkRedisWarned) return;
  g.__zkRedisWarned = true;
  console.warn(`[proofCache] ${message} — falling back to the in-memory cache.`);
}

/** The shared Redis client, or null when Redis isn't configured or isn't reachable. */
function client(): Redis | null {
  if (g.__zkRedis !== undefined) return g.__zkRedis;

  const url = process.env.REDIS_URL;
  // An unreplaced placeholder is a misconfiguration, not a URL; treat it as "not configured" rather than
  // failing every request while someone is still filling the file in.
  if (!url || url.includes("<PASSWORD>")) {
    g.__zkRedis = null;
    return null;
  }

  try {
    // Required at call time so a deployment without Redis never loads the driver at all.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const IORedis = require("ioredis") as typeof import("ioredis").default;
    const redis = new IORedis(url, {
      /**
       * The offline queue must stay ENABLED.
       *
       * Disabling it looked like the safe "fail fast" choice, but the client connects asynchronously, so
       * the very first command after startup is issued before the socket is writeable and dies with
       * "Stream isn't writeable and enableOfflineQueue options is false". That made every cold start miss
       * the cache — precisely the case Redis was added to fix. With the queue on, the first command waits
       * for the connection instead.
       *
       * Failing fast is achieved with timeouts rather than by dropping commands: `connectTimeout` bounds
       * the handshake (measured ~1.7s to this host, so 8s leaves real headroom) and `commandTimeout`
       * bounds each command, so an unreachable Redis costs a bounded delay and then falls back to memory.
       */
      connectTimeout: 8_000,
      commandTimeout: 5_000,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: true,
      lazyConnect: false,
      // Give up reconnecting after a few tries rather than looping for the life of the process.
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 500, 2_000)),
    });
    redis.on("error", (e: Error) => warnOnce(`Redis error: ${e.message}`));
    g.__zkRedis = redis;
    return redis;
  } catch (e) {
    warnOnce(`could not initialise Redis: ${(e as Error).message}`);
    g.__zkRedis = null;
    return null;
  }
}

/** Key derived from a hash, so the salt never lands in a Redis key. */
export function proofKey(ephemeralPubKeyB64: string, maxEpoch: number, salt: string): string {
  const digest = createHash("sha256")
    .update(`${ephemeralPubKeyB64}|${maxEpoch}|${salt}`)
    .digest("base64url");
  return `${PREFIX}${digest}`;
}

/**
 * Return the cached proof for this key, minting it with `mint` if absent.
 *
 * The in-flight promise is shared, so two near-simultaneous transactions (a presignature purchase and a
 * sign, say) wait on one mint instead of racing each other into the rate limit. A failure is never
 * cached: the entry is dropped so the next attempt re-mints.
 */
export async function getOrMintProof<P>(
  key: string,
  mint: () => Promise<CachedProof<P>>
): Promise<{ proof: CachedProof<P>; source: "memory" | "redis" | "minted" }> {
  const local = memory.get(key) as Promise<CachedProof<P>> | undefined;
  if (local) return { proof: await local, source: "memory" };

  const redis = client();
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw) {
        const proof = JSON.parse(raw) as CachedProof<P>;
        // Seed the local map too, so subsequent requests on this instance skip the round-trip.
        memory.set(key, Promise.resolve(proof));
        return { proof, source: "redis" };
      }
    } catch (e) {
      warnOnce(`read failed: ${(e as Error).message}`);
    }
  }

  const pending = mint();
  memory.set(key, pending as Promise<CachedProof<unknown>>);
  pending.catch(() => memory.delete(key));

  const proof = await pending;

  if (redis) {
    // Write-behind: the proof is already usable, so a slow or failed write must not delay the response.
    void redis
      .set(key, JSON.stringify(proof), "EX", TTL_SECONDS)
      .catch((e: Error) => warnOnce(`write failed: ${e.message}`));
  }

  return { proof, source: "minted" };
}

/** Whether a Redis-backed cache is active. Reported by the health check. */
export function proofCacheBackend(): "redis" | "memory" {
  return client() ? "redis" : "memory";
}

/** Round-trip Redis, for diagnostics. Resolves to null when Redis isn't configured. */
export async function pingProofCache(): Promise<{ ok: boolean; detail: string } | null> {
  const redis = client();
  if (!redis) return null;
  try {
    const started = Date.now();
    const pong = await redis.ping();
    return { ok: pong === "PONG", detail: `${pong} in ${Date.now() - started}ms` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
