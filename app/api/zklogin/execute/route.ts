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
 * The Groth16 proof is cached and reused for the whole session — see lib/zklogin/proofCache.ts for why
 * that is sound (it depends only on the ephemeral key, maxEpoch and salt, never on the transaction) and
 * how it degrades when Redis is absent.
 */
import { getOrMintProof, proofKey, type CachedProof } from "@/lib/zklogin/proofCache";

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
    const key = proofKey(ephemeralPubKeyB64, maxEpoch, session.salt);
    type ProofCore = Awaited<ReturnType<typeof createZkLoginProof>>;
    const mint = async (): Promise<CachedProof<ProofCore>> => {
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
    };

    /**
     * Pre-warm: mint the proof now so the first real transaction doesn't pay for it.
     *
     * The proof is the single largest fixed cost in a zkLogin transaction and it is entirely
     * independent of the transaction, so minting it while the user is still looking at the wallet
     * screen takes it off the critical path completely.
     */
    if (prewarmOnly) {
      const { source } = await getOrMintProof(key, mint);
      return NextResponse.json({ prewarmed: true, source });
    }

    const {
      proof: { proofCore, addressSeed: seed },
    } = await getOrMintProof(key, mint);

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
