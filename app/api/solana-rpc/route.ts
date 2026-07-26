import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Server-side Solana RPC proxy, so Solana has more than one usable endpoint.
 *
 * Solana is the only chain here with a single viable free endpoint from a browser. Probed with a browser
 * Origin, every alternative refuses: api.mainnet-beta.solana.com and rpc.ankr.com return 403,
 * onfinality and Alchemy's demo key 429, drpc 400, and several others do not resolve. That left
 * solana-rpc.publicnode.com as a single point of failure — and when it rate-limited an IP, Solana
 * balances simply stopped.
 *
 * The restriction is CORS, not access: the same endpoints answer fine without an Origin header
 * (api.mainnet-beta.solana.com measured 292ms server-side). Proxying therefore turns one endpoint into
 * two independent ones, which matters because Solana is the chain this wallet leads with.
 *
 * NOT AN OPEN RELAY
 * -----------------
 * Only the methods this app actually calls are forwarded. Without that allowlist this route would be a
 * free, anonymous Solana RPC that anyone could point their own app at, on our bandwidth.
 */

/** Upstreams, fastest first, both verified server-side. */
const UPSTREAMS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
];

/** Exactly what the wallet needs: read balances, build a transfer, broadcast it, confirm it. */
const ALLOWED_METHODS = new Set([
  "getBalance",
  "getLatestBlockhash",
  "getFeeForMessage",
  "getSignatureStatuses",
  "getEpochInfo",
  "getMinimumBalanceForRentExemption",
  "sendTransaction",
  "simulateTransaction",
]);

const TIMEOUT_MS = 9_000;

export async function POST(req: NextRequest) {
  let body: { method?: string; jsonrpc?: string; id?: unknown; params?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body?.method || typeof body.method !== "string") {
    return NextResponse.json({ error: "missing method" }, { status: 400 });
  }
  if (!ALLOWED_METHODS.has(body.method)) {
    return NextResponse.json(
      { error: `method not proxied: ${body.method}` },
      { status: 403 }
    );
  }

  let lastError = "no upstream reached";
  for (const upstream of UPSTREAMS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(upstream, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) {
        lastError = `${upstream}: HTTP ${res.status}`;
        continue;
      }
      const json = await res.json();
      // A JSON-RPC error is a legitimate answer (an account that doesn't exist, say), not an upstream
      // failure — pass it straight through rather than retrying another endpoint.
      return NextResponse.json(json, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      const err = e as Error;
      lastError = `${upstream}: ${err.name === "AbortError" ? "timeout" : err.message}`;
    } finally {
      clearTimeout(timer);
    }
  }

  return NextResponse.json({ error: "solana rpc unavailable", detail: lastError }, { status: 502 });
}
