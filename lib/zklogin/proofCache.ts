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
import { cacheGet, cacheSet, cachePing, redisEnabled } from "@/lib/cache/redis";

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
 * The in-memory fallback, on `globalThis` so a Fast Refresh doesn't discard it.
 *
 * The Redis client itself lives in lib/cache/redis.ts — one connection shared with the other server-side
 * caches, and one place that knows how to degrade when Redis is absent.
 */
const g = globalThis as typeof globalThis & {
  __zkProofMemory?: Map<string, Promise<CachedProof<unknown>>>;
};

const memory: Map<string, Promise<CachedProof<unknown>>> = (g.__zkProofMemory ??= new Map());

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

  const shared = await cacheGet<CachedProof<P>>(key);
  if (shared) {
    // Seed the local map too, so subsequent requests on this instance skip the round-trip.
    memory.set(key, Promise.resolve(shared) as Promise<CachedProof<unknown>>);
    return { proof: shared, source: "redis" };
  }

  const pending = mint();
  memory.set(key, pending as Promise<CachedProof<unknown>>);
  pending.catch(() => memory.delete(key));

  const proof = await pending;

  // Write-behind: the proof is already usable, so a slow or failed write must not delay the response.
  cacheSet(key, proof, TTL_SECONDS);

  return { proof, source: "minted" };
}

/** Whether a Redis-backed cache is active. */
export function proofCacheBackend(): "redis" | "memory" {
  return redisEnabled() ? "redis" : "memory";
}

/** Round-trip Redis, for diagnostics. Resolves to null when Redis isn't configured. */
export const pingProofCache = cachePing;
