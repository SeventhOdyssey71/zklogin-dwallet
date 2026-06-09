import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { fromBase64 } from "@mysten/sui/utils";
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
 * sends (e.g. presign + sign) share one mint instead of racing into the rate limit. On failure the
 * entry is evicted so the next attempt re-mints.
 *
 * Note: this is in-memory, so it's per server instance — great in dev and for a warm instance; on
 * scaled/serverless it degrades gracefully to a fresh mint per cold instance. For a hard guarantee
 * across instances, back this with Redis/KV keyed the same way.
 */
type CachedProof = {
  proofCore: Awaited<ReturnType<typeof createZkLoginProof>>;
  addressSeed: string;
};
const proofCache = new Map<string, Promise<CachedProof>>();

function proofKey(ephemeralPubKeyB64: string, maxEpoch: number, salt: string): string {
  return `${ephemeralPubKeyB64}:${maxEpoch}:${salt}`;
}

/**
 * POST /api/zklogin/execute
 *   { txBytesB64, userSignature, ephemeralPubKeyB64, maxEpoch, randomness }
 *   → { digest }
 *
 * The signing finale:
 *   1. Get the zkLogin proof — from the per-session cache, or mint it via Shinami on first use.
 *   2. Combine proof + the user's ephemeral signature → zkLoginSignature.
 *   3. Submit the tx.
 */
export async function POST(req: NextRequest) {
  const jar = await cookies();
  const session = openSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { txBytesB64, userSignature, ephemeralPubKeyB64, maxEpoch, randomness } =
    (await req.json()) as {
      txBytesB64: string;
      userSignature: string;
      ephemeralPubKeyB64: string;
      maxEpoch: number;
      randomness: string;
    };
  if (!txBytesB64 || !userSignature || !ephemeralPubKeyB64 || maxEpoch == null || !randomness) {
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
    const { proofCore, addressSeed: seed } = await pending;

    const signature = assembleSignature({
      proof: { ...proofCore, addressSeed: seed },
      maxEpoch,
      userSignature,
    });

    const network = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet") as
      | "testnet"
      | "mainnet"
      | "devnet";
    const client = new SuiClient({ url: getFullnodeUrl(network) });
    const res = await client.executeTransactionBlock({
      transactionBlock: fromBase64(txBytesB64),
      signature,
      options: { showEffects: true },
    });
    return NextResponse.json({ digest: res.digest });
  } catch (e) {
    console.error("[zklogin/execute]", (e as Error).message);
    return NextResponse.json(
      { error: "execute failed", detail: (e as Error).message },
      { status: 502 }
    );
  }
}
