import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { openSession, SESSION_COOKIE } from "@/lib/zklogin/session";
import { dbEnabled } from "@/lib/db/client";
import { readUserStats, upsertAddresses, upsertUser, type DerivedAddress } from "@/lib/db/queries";

export const runtime = "nodejs";

/**
 * The account's row in the durable store.
 *
 * WHY THIS EXISTS
 * ---------------
 * Redis holds the account's history and its caches, which is the right shape for "what did this one user
 * do". It is the wrong shape for "how many people use this, and how much has moved" — questions that
 * need to be asked across users rather than about one. Postgres answers those, so the wallet writes a row
 * per account and a row per derived address as it discovers them.
 *
 * AUTHORIZATION
 * -------------
 * The Sui address comes from the sealed session cookie, never from the request body. This is the whole
 * security boundary of the endpoint: a body-supplied address would let anyone attach addresses to — or
 * read the volume of — an account they named, and the derived-address table is precisely a map of which
 * chain addresses belong to which person.
 *
 * A DB OUTAGE IS NOT AN ERROR HERE
 * --------------------------------
 * Every path returns 200 with `recorded: false` rather than a 5xx. The caller is fire-and-forget from a
 * dashboard load; surfacing a failure would put a red toast on a wallet that is working perfectly, and
 * teach the client to retry something nobody is waiting on.
 */

/**
 * Ika's on-chain curve discriminant, as a name.
 *
 * Kept in step with `getDWalletAddresses` in lib/ika/walletDetail.ts, which reads the same integer:
 * 0 is secp256k1, 3 is Ristretto, and everything else is Ed25519. Mapped here rather than trusting a
 * client-supplied label, so the column cannot be filled with arbitrary text.
 */
function curveName(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value === 0) return "secp256k1";
  if (value === 3) return "ristretto";
  return "ed25519";
}

/** Reject anything that isn't a well-formed derived address, so one bad entry can't poison the table. */
function sanitizeAddress(value: unknown): DerivedAddress | null {
  if (!value || typeof value !== "object") return null;
  const a = value as Record<string, unknown>;
  if (typeof a.chain !== "string" || !a.chain) return null;
  if (typeof a.address !== "string" || !a.address) return null;
  return {
    chain: a.chain.slice(0, 40),
    address: a.address.slice(0, 200),
    curve: curveName(a.curve),
  };
}

/**
 * Cap the batch.
 *
 * Discovery reports one address per supported chain, which is a number in the teens. Anything much
 * larger is a bug or an attempt to fill the table, and neither deserves a database round trip.
 */
const MAX_ADDRESSES = 64;

/** GET → the signed-in account's own totals. Never another account's, and never the overall figures. */
export async function GET() {
  const jar = await cookies();
  const session = openSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const stats = await readUserStats(session.address);
  return NextResponse.json(
    { stats, durable: dbEnabled() },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * POST → record the account and, optionally, the addresses its dWallets derive.
 *
 * Called on sign-in and again whenever the dashboard finishes discovery. Both are upserts, so calling it
 * on every page load is the intended usage rather than something to guard against: the repeat visits are
 * what keep `last_seen` meaningful.
 */
export async function POST(req: NextRequest) {
  const jar = await cookies();
  const session = openSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  /**
   * A body is optional.
   *
   * The sign-in call has nothing to say beyond "this person is here", and making it send `{}` just to
   * satisfy a parser would be ceremony. An unparseable body is treated the same way — as no addresses —
   * rather than as a 400, because the account upsert below is still worth doing.
   */
  let body: { addresses?: unknown } = {};
  try {
    body = (await req.json()) as { addresses?: unknown };
  } catch {
    body = {};
  }

  const addresses = Array.isArray(body.addresses)
    ? body.addresses
        .slice(0, MAX_ADDRESSES)
        .map(sanitizeAddress)
        .filter((a): a is DerivedAddress => a !== null)
    : [];

  // Profile fields come from the sealed session too — they arrived in the OIDC token, not from the client.
  const recorded = await upsertUser(session.address, session.email ?? null, session.name ?? null);
  const stored = recorded ? await upsertAddresses(session.address, addresses) : 0;

  if (!recorded && dbEnabled()) {
    // Configured but refusing: worth a line in the server log, and still not worth a 5xx to the wallet.
    console.warn(`[api/account] could not record ${session.address.slice(0, 12)}…`);
  }

  return NextResponse.json({ recorded, addresses: stored, durable: dbEnabled() });
}
