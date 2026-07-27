import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { openSession, SESSION_COOKIE } from "@/lib/zklogin/session";
import { CHAIN_BY_ID } from "@/lib/config/chainRegistry";
import { cacheGet } from "@/lib/cache/redis";
import { dbEnabled } from "@/lib/db/client";
import { insertTransaction, type TransactionRecord, type TxKind } from "@/lib/db/queries";

export const runtime = "nodejs";

/**
 * The durable ledger of outbound value.
 *
 * WHY THIS IS SEPARATE FROM /api/history
 * --------------------------------------
 * History is the user's own view of their wallet: it includes detected receives, it is capped at 500
 * entries, and it is stored per account as one Redis blob because that is what rendering a list wants.
 * This table answers a different question — how much has moved, across everyone, over time — which needs
 * rows you can aggregate and index, and needs them to never be evicted. The two record overlapping facts
 * on purpose; neither is derivable from the other.
 *
 * AUTHORIZATION
 * -------------
 * The Sui address is taken from the sealed session cookie, never from the request body. Volume is the
 * number this table exists to produce, so a body-supplied address would let anyone inflate any account's
 * figures — including their own — by naming it.
 *
 * A DB OUTAGE IS NOT AN ERROR HERE
 * --------------------------------
 * This is called after a transaction has already been signed and broadcast. Nothing about the response
 * can change what happened on-chain, and the client does not wait for it, so every path returns 200 with
 * `recorded: false` rather than a 5xx.
 */

/**
 * Shared price cache, written by /api/chain-assets.
 *
 * Read directly rather than by fetching that route: this already runs on the server, and an internal HTTP
 * hop to reach a value that is sitting in Redis is latency for nothing. A miss simply means the
 * transaction is stored unpriced.
 */
const ASSETS_CACHE_KEY = "chain-assets:v1";

interface CachedAsset {
  symbol: string;
  price: number;
}

/**
 * Decimal amounts only.
 *
 * No sign, no exponent, no thousands separators — these come from an amount field the user typed and a
 * balance the wallet formatted, both of which are plain decimals. Rejecting the rest keeps `numeric` from
 * having to interpret anything, and keeps a nonsense value out of the sums.
 */
const AMOUNT_RE = /^\d+(\.\d+)?$/;

interface Sanitized extends TransactionRecord {
  /** Present only so pricing can look the chain up; not stored separately. */
  chain: string;
}

/** Reject anything that isn't a well-formed transaction, so one bad write can't skew the volume figures. */
function sanitize(value: unknown): Sanitized | null {
  if (!value || typeof value !== "object") return null;
  const t = value as Record<string, unknown>;

  if (t.kind !== "send" && t.kind !== "swap") return null;
  if (typeof t.chain !== "string" || !t.chain) return null;
  if (typeof t.symbol !== "string" || !t.symbol) return null;
  if (typeof t.amount !== "string") return null;

  const amount = t.amount.trim();
  if (!AMOUNT_RE.test(amount) || amount.length > 80) return null;

  return {
    kind: t.kind as TxKind,
    chain: t.chain.slice(0, 40),
    symbol: t.symbol.slice(0, 20),
    amount,
    // Filled in below from the server's own price cache; a client-supplied valuation is never used.
    usdValue: null,
    txHash: typeof t.txHash === "string" && t.txHash ? t.txHash.slice(0, 200) : null,
    counterparty:
      typeof t.counterparty === "string" && t.counterparty ? t.counterparty.slice(0, 200) : null,
  };
}

/**
 * Value the transfer in USD, or don't.
 *
 * Priced server-side rather than accepted from the body for the same reason the address is: this number
 * is the product, and a client that can name it can name anything. The trade-off is coverage — the shared
 * cache holds one price per chain, its GAS token — so a transfer of some other asset (a Sui coin type, an
 * ERC-20) records its amount and no valuation.
 *
 * The symbol check is what makes that honest. Without it, sending 500 USDC on Ethereum would be priced at
 * the ETH rate and land in the totals as a six-figure transfer.
 */
async function priceInUsd(chain: string, symbol: string, amount: string): Promise<number | null> {
  const expected = CHAIN_BY_ID[chain]?.symbol;
  if (!expected || expected.toUpperCase() !== symbol.toUpperCase()) return null;

  const assets = await cacheGet<Record<string, CachedAsset>>(ASSETS_CACHE_KEY);
  const price = assets?.[chain]?.price;
  if (!price || price <= 0) return null;

  const value = Number(amount) * price;
  // An amount long enough to overflow a double is not a valuation anyone should act on.
  return Number.isFinite(value) ? value : null;
}

/**
 * POST → record one outbound transaction.
 *
 * Deliberately singular. The client posts each transaction as it is broadcast, so there is no batch to
 * accept, and the (chain, tx_hash) unique index makes a repeat of one that is already stored a no-op
 * rather than a duplicate row.
 */
export async function POST(req: NextRequest) {
  const jar = await cookies();
  const session = openSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const tx = sanitize(body);
  if (!tx) return NextResponse.json({ error: "invalid transaction" }, { status: 400 });

  // Skip the price lookup entirely when there is nowhere to store the result.
  if (dbEnabled()) tx.usdValue = await priceInUsd(tx.chain, tx.symbol, tx.amount);

  const recorded = await insertTransaction(
    session.address,
    session.email ?? null,
    session.name ?? null,
    tx
  );

  return NextResponse.json({ recorded, priced: tx.usdValue !== null, durable: dbEnabled() });
}
