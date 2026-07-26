import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { openSession, SESSION_COOKIE } from "@/lib/zklogin/session";
import { cacheGet, cacheSet, redisEnabled } from "@/lib/cache/redis";

export const runtime = "nodejs";

/**
 * Durable transaction history.
 *
 * WHY THIS EXISTS
 * ---------------
 * History was `localStorage` only, which made it a per-browser artefact: sign in on a phone and your
 * transfers were simply gone, and clearing site data erased the record permanently. Redis makes it belong
 * to the account instead of to the device.
 *
 * `localStorage` stays as the client's cache — it renders instantly and keeps working offline — but this
 * is now the source of truth.
 *
 * AUTHORIZATION
 * -------------
 * The address is taken from the sealed session cookie, never from the request body. Trusting a
 * client-supplied address would let anyone read or forge any account's history by naming it, and the whole
 * point of the ledger is that it reflects what actually happened.
 */

/** Match the client's cap, so the two cannot disagree about what gets dropped. */
const MAX_ENTRIES = 500;

/** Long-lived: history is a record, not a cache of something recomputable. 180 days. */
const TTL_SECONDS = 180 * 24 * 60 * 60;

interface HistoryEntry {
  id: string;
  kind: "send" | "receive";
  chain: string;
  symbol: string;
  amount: string;
  counterparty?: string;
  txHash?: string;
  at: number;
  detected?: boolean;
}

const keyFor = (address: string) => `zk:history:${address}`;

/** Reject anything that isn't a well-formed entry, so one bad write can't poison the ledger. */
function sanitize(value: unknown): HistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  if (typeof e.id !== "string" || !e.id) return null;
  if (e.kind !== "send" && e.kind !== "receive") return null;
  if (typeof e.chain !== "string" || typeof e.symbol !== "string") return null;
  if (typeof e.amount !== "string") return null;
  if (typeof e.at !== "number" || !Number.isFinite(e.at)) return null;
  return {
    id: e.id.slice(0, 200),
    kind: e.kind,
    chain: e.chain.slice(0, 40),
    symbol: e.symbol.slice(0, 20),
    amount: e.amount.slice(0, 80),
    counterparty: typeof e.counterparty === "string" ? e.counterparty.slice(0, 200) : undefined,
    txHash: typeof e.txHash === "string" ? e.txHash.slice(0, 200) : undefined,
    at: e.at,
    detected: e.detected === true ? true : undefined,
  };
}

async function requireAddress(): Promise<string | null> {
  const jar = await cookies();
  return openSession(jar.get(SESSION_COOKIE)?.value)?.address ?? null;
}

/** GET → the signed-in account's stored history, newest first. */
export async function GET() {
  const address = await requireAddress();
  if (!address) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  // Without Redis this is simply empty and the client keeps using its local copy.
  const stored = (await cacheGet<HistoryEntry[]>(keyFor(address))) ?? [];
  return NextResponse.json(
    { entries: stored, durable: redisEnabled() },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * POST → merge entries into the stored history.
 *
 * A merge rather than a replace: two tabs can each hold entries the other has never seen, and a
 * last-writer-wins replace would silently delete one of them. Deduplicated by id, newest first.
 */
export async function POST(req: NextRequest) {
  const address = await requireAddress();
  if (!address) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  let body: { entries?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.entries)) {
    return NextResponse.json({ error: "entries must be an array" }, { status: 400 });
  }

  const incoming = body.entries.map(sanitize).filter((e): e is HistoryEntry => e !== null);
  if (incoming.length === 0) {
    return NextResponse.json({ merged: 0, durable: redisEnabled() });
  }

  const existing = (await cacheGet<HistoryEntry[]>(keyFor(address))) ?? [];
  const byId = new Map<string, HistoryEntry>();
  // Existing first, so a replay of an entry we already hold cannot rewrite its recorded time.
  for (const e of existing) byId.set(e.id, e);
  let added = 0;
  for (const e of incoming) {
    if (!byId.has(e.id)) {
      byId.set(e.id, e);
      added++;
    }
  }

  const merged = [...byId.values()].sort((a, b) => b.at - a.at).slice(0, MAX_ENTRIES);
  cacheSet(keyFor(address), merged, TTL_SECONDS);

  return NextResponse.json({ merged: added, total: merged.length, durable: redisEnabled() });
}
