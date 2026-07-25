import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fromBase64 } from "@mysten/sui/utils";
import { createSuiClient } from "@/lib/sui/client";
import { openSession, SESSION_COOKIE } from "@/lib/zklogin/session";
import { createZkLoginProof } from "@/lib/zklogin/shinami";
import {
  extendedEphemeralPublicKey,
  addressSeed,
  assembleSignature,
} from "@/lib/zklogin/zklogin";

export const runtime = "nodejs";

/**
 * Proof cache — the Groth16 proof (`createZkLoginProof`, ~2-4s and rate-limited to ~2/min/address)
 * is valid for the WHOLE ephemeral session (until `maxEpoch`) and only depends on
 * (ephemeralPubKey, maxEpoch, salt/jwt/randomness) — NOT on the transaction. So we mint it once and
 * reuse it across every send; only the cheap `userSignature` changes per tx.
 *
 * Keyed by ephemeralPubKey:maxEpoch:salt. We store the in-flight Promise so two near-simultaneous
 * sends (e.g. a presignature purchase + a sign) share one mint instead of racing into the rate limit.
 * On failure the entry is evicted so the next attempt re-mints.
 *
 * WHY IT HANGS OFF globalThis
 * ---------------------------
 * A plain module-level `Map` is discarded whenever Next.js hot-reloads this route, so in development
 * every code edit silently reintroduced a 2-4s proof mint on the next transaction — and it looked like
 * network latency rather than a lost cache. `globalThis` survives module re-evaluation, so the cache
 * lives as long as the server process.
 *
 * Still per-instance: on scaled/serverless deployments each cold instance mints once. For a hard
 * cross-instance guarantee, back this with Redis/KV keyed exactly the same way.
 */
type CachedProof = {
  proofCore: Awaited<ReturnType<typeof createZkLoginProof>>;
  addressSeed: string;
};
const globalForProofs = globalThis as typeof globalThis & {
  __zkProofCache?: Map<string, Promise<CachedProof>>;
};
const proofCache: Map<string, Promise<CachedProof>> = (globalForProofs.__zkProofCache ??= new Map());

function proofKey(ephemeralPubKeyB64: string, maxEpoch: number, salt: string): string {
  return `${ephemeralPubKeyB64}:${maxEpoch}:${salt}`;
}

/**
 * POST /api/zklogin/execute
 *   { txBytesB64, userSignature, ephemeralPubKeyB64, maxEpoch, randomness }
 *   → { digest, effects, events, objectChanges }
 *
 * Or, with `{ prewarmOnly: true }` and no transaction, mint and cache the proof only — see below.
 *
 * The signing finale:
 *   1. Get the zkLogin proof — from the per-session cache, or mint it via Shinami on first use.
 *   2. Combine proof + the user's ephemeral signature → zkLoginSignature.
 *   3. Submit the tx and return its effects.
 */
export async function POST(req: NextRequest) {
  const jar = await cookies();
  const session = openSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { txBytesB64, userSignature, ephemeralPubKeyB64, maxEpoch, randomness, prewarmOnly } =
    (await req.json()) as {
      txBytesB64?: string;
      userSignature?: string;
      ephemeralPubKeyB64: string;
      maxEpoch: number;
      randomness: string;
      prewarmOnly?: boolean;
    };

  // A pre-warm needs only the session identifiers; a real execution needs the transaction too.
  if (!ephemeralPubKeyB64 || maxEpoch == null || !randomness) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  if (!prewarmOnly && (!txBytesB64 || !userSignature)) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  // sub + aud come from the (already-verified-at-login) JWT payload.
  const claims = JSON.parse(
    Buffer.from(session.jwt.split(".")[1], "base64url").toString("utf8")
  ) as { sub: string; aud: string };

  try {
    // Reuse the session's proof if we've already minted it; otherwise mint once and cache.
    const key = proofKey(ephemeralPubKeyB64, maxEpoch, session.salt);
    let pending = proofCache.get(key);
    const cached = pending !== undefined;
    if (!pending) {
      pending = (async (): Promise<CachedProof> => {
        const proofCore = await createZkLoginProof({
          jwt: session.jwt,
          maxEpoch,
          extendedEphemeralPublicKey: extendedEphemeralPublicKey(ephemeralPubKeyB64),
          jwtRandomness: randomness,
          salt: session.salt,
        });
        return {
          proofCore,
          addressSeed: addressSeed({ salt: session.salt, sub: claims.sub, aud: claims.aud }),
        };
      })();
      proofCache.set(key, pending);
      // Don't cache failures — let the next attempt re-mint.
      pending.catch(() => proofCache.delete(key));
    }

    /**
     * Pre-warm: mint the proof now so the first real transaction doesn't pay for it.
     *
     * The proof is the single largest fixed cost in a zkLogin transaction and it is entirely
     * independent of the transaction, so minting it while the user is still looking at the wallet
     * screen takes it off the critical path completely.
     */
    if (prewarmOnly) {
      await pending;
      return NextResponse.json({ prewarmed: true, cached });
    }

    const { proofCore, addressSeed: seed } = await pending;

    const signature = assembleSignature({
      proof: { ...proofCore, addressSeed: seed },
      maxEpoch,
      userSignature: userSignature!,
    });

    const client = createSuiClient();
    /**
     * Ask for effects, events and object changes here.
     *
     * The caller needs all three (to find the presign/sign session ids) and used to fetch them with a
     * second `waitForTransaction` round-trip after this returned — which additionally had to wait for
     * the fullnode to index the transaction. Execution already computes them, so returning them
     * removes roughly a second of pure waiting from *every* Sui transaction on the send path.
     */
    const res = await client.executeTransactionBlock({
      transactionBlock: fromBase64(txBytesB64!),
      signature,
      options: { showEffects: true, showEvents: true, showObjectChanges: true },
    });
    return NextResponse.json({
      digest: res.digest,
      effects: res.effects,
      events: res.events,
      objectChanges: res.objectChanges,
    });
  } catch (e) {
    console.error("[zklogin/execute]", (e as Error).message);
    return NextResponse.json(
      { error: "execute failed", detail: (e as Error).message },
      { status: 502 }
    );
  }
}
