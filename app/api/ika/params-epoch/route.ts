import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { openSession, SESSION_COOKIE } from "@/lib/zklogin/session";
import { cacheGet, cacheSet, redisEnabled } from "@/lib/cache/redis";

export const runtime = "nodejs";

/**
 * Which reconfiguration epoch the shipped wasm can still read.
 *
 * WHY THIS IS WORTH A ROUND-TRIP
 * -----------------------------
 * Recovering protocol public parameters means finding the newest epoch whose payload the wasm can parse
 * (see lib/ika/protocolParams.ts). Finding it from scratch is expensive in a way that has nothing to do
 * with cryptography: the reconfiguration table holds one entry per epoch — 360 of them and growing — and
 * `getDynamicFields` pages at 50, so just *enumerating* them costs eight sequential round-trips before a
 * single candidate is probed. That is the bulk of the ~19s a cold resolve takes.
 *
 * The answer is one small integer, identical for every user, and it only changes when Ika ships a wasm
 * that can read a newer format. So it is close to ideal to cache: with a hint, the client reads that one
 * epoch's dynamic field directly and skips enumeration entirely.
 *
 * NOT USER DATA
 * -------------
 * This is a public fact about the network, so it is stored under one shared key rather than per account.
 * Writes still require a signed-in session — not because the value is sensitive, but because an
 * unauthenticated write endpoint is an invitation. A poisoned value degrades gracefully anyway: the client
 * verifies the hint by actually parsing that epoch, and falls back to the full walk if it does not work.
 */

const KEY = "ika:params-epoch:v1";

/** A day. The answer is stable until Ika ships a fixed wasm, and re-deriving it is merely slow, not wrong. */
const TTL_SECONDS = 24 * 60 * 60;

interface Hint {
  /** Encryption key object id, so a hint cannot leak across networks or a key rotation. */
  encryptionKeyId: string;
  epoch: number;
  at: number;
}

export async function GET(req: NextRequest) {
  const encryptionKeyId = req.nextUrl.searchParams.get("encryptionKeyId");
  if (!encryptionKeyId) {
    return NextResponse.json({ error: "encryptionKeyId required" }, { status: 400 });
  }

  const hint = await cacheGet<Hint>(KEY);
  // A hint for a different encryption key is not applicable — treat it as absent.
  const epoch = hint && hint.encryptionKeyId === encryptionKeyId ? hint.epoch : null;

  return NextResponse.json(
    { epoch, durable: redisEnabled() },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  const jar = await cookies();
  if (!openSession(jar.get(SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  let body: { encryptionKeyId?: unknown; epoch?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { encryptionKeyId, epoch } = body;
  if (typeof encryptionKeyId !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(encryptionKeyId)) {
    return NextResponse.json({ error: "bad encryptionKeyId" }, { status: 400 });
  }
  if (typeof epoch !== "number" || !Number.isInteger(epoch) || epoch < 0 || epoch > 1e9) {
    return NextResponse.json({ error: "bad epoch" }, { status: 400 });
  }

  /**
   * Only ever move the hint forward.
   *
   * Clients race — several tabs can discover a usable epoch at once, and an older one is still *correct*,
   * just slower to find nothing newer from. Keeping the highest known-good epoch means the hint improves
   * monotonically instead of flapping between whichever request landed last.
   */
  const existing = await cacheGet<Hint>(KEY);
  const keep =
    existing && existing.encryptionKeyId === encryptionKeyId && existing.epoch >= epoch
      ? existing
      : { encryptionKeyId, epoch, at: Date.now() };

  cacheSet(KEY, keep, TTL_SECONDS);
  return NextResponse.json({ epoch: keep.epoch, durable: redisEnabled() });
}
