'use client';

/**
 * NEAR Intents (1Click) — moving value onto Sui without a bridge integration.
 *
 * WHY THIS AND NOT CCTP
 * ---------------------
 * Ika signs; it does not move value. So getting SOL onto Sui needs an external service, and this one fits
 * this wallet's single strongest primitive exactly: it hands back a **deposit address on the source chain**,
 * and the whole user-side action is an ordinary transfer to it. That is byte-for-byte what the Solana signer
 * already emits, so the Solana leg needs no new signing code at all.
 *
 * Circle's CCTP has a better trust model and is worth keeping for large EVM→USDC moves, but it cannot do this
 * route: Solana's CCTP is an Anchor program, so `lib/pipeline/cctp.ts`'s `encodeFunctionData('depositForBurn')`
 * is useless there. CCTP would also cost two source signatures plus a five-call Move mint on Sui. This costs
 * one transfer.
 *
 * THE LATENCY WORRY THAT TURNED OUT NOT TO MATTER
 * ----------------------------------------------
 * A signature here takes ~13s, which usually races a quote. Measured against the live API, the quote is locked
 * to the deposit address server-side and does not re-price: `minAmountOut` was identical at t+0s, t+15s and
 * t+60s. So the committed minimum survives however long signing takes.
 *
 * THE RISK THAT DOES MATTER
 * -------------------------
 * There are two deadlines and they mean different things. The one you REQUEST is when a refund begins if the
 * swap has not completed. The one the response RETURNS is that plus 72 hours, and the spec's wording for it is
 * "the deposit address becomes inactive and funds may be lost". So the deadline is set generously here — it
 * costs nothing, and it is a refund trigger rather than a quote expiry.
 *
 * TRUST, STATED PLAINLY
 * ---------------------
 * Between the deposit landing and the fill arriving, a solver network holds the funds. That is weaker than
 * CCTP, where nobody can keep your money, and stronger than an exchange: no KYC, no account, no discretionary
 * human, and the refund path is protocol-driven. The service signs its quote, which is evidence of the
 * commitment but not something enforceable on Sui.
 */

const BASE = 'https://1click.chaindefuser.com/v0';

/**
 * When an unfilled swap starts refunding.
 *
 * Generous by design: this is the refund TRIGGER, not a quote expiry, so a tight value risks refunding a
 * swap that was about to fill. Settlement measured ~35s, so an hour is roughly a hundred times the
 * observed time and still bounds the wait to something a person will sit through.
 */
const DEADLINE_MS = 60 * 60 * 1000;

/** Requests time out rather than hanging a dialog. */
const TIMEOUT_MS = 15_000;

export interface IntentToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number;
  contractAddress?: string;
}

/**
 * The wire shape, which nests the numbers under `quote`.
 *
 * Worth naming rather than reading inline: a dry quote returns NO `depositAddress`, because nothing is
 * reserved — that field only appears once `dry: false` commits and starts the address's clock. Reading it
 * optimistically is how you end up telling a user to send funds to `undefined`.
 */
interface OneClickResponse {
  quote: Omit<IntentQuote, 'depositAddress' | 'deadline'> & {
    depositAddress?: string;
    deadline?: string;
  };
  quoteRequest?: { deadline?: string; refundTo?: string };
  signature?: string;
}

export interface IntentQuote {
  /**
   * Where to send the funds — a plain address on the source chain.
   *
   * Absent on a dry quote by design; only a committed quote reserves one.
   */
  depositAddress?: string;
  /** Exact amount to send, in the source asset's smallest unit. */
  amountIn: string;
  amountInFormatted?: string;
  /** Expected output, smallest unit of the destination asset. */
  amountOut: string;
  amountOutFormatted?: string;
  /** The committed floor. This is the number that actually protects the user. */
  minAmountOut: string;
  /** When the deposit address goes inactive — request deadline + 72h. Funds may be lost after this. */
  deadline?: string;
  /** Fee charged if the swap refunds, in the origin asset's smallest unit. */
  refundFee?: string;
  /** Fee taken on the payout, in the destination asset's smallest unit. */
  withdrawFee?: string;
  amountInUsd?: string;
  amountOutUsd?: string;
  timeWhenInactive?: string;
  /** Seconds the service expects settlement to take. */
  timeEstimate?: number;
  /** The service signing its own quote back to us. Nothing for us to countersign. */
  signature?: string;
  /**
   * When an unfilled swap begins refunding — the deadline we REQUESTED, echoed back.
   *
   * Distinct from `deadline`, which is this plus 72 hours and is when the deposit address dies. This is
   * the one a user cares about: the moment they stop waiting and get their money back.
   */
  refundsAt?: string;
  /** Where a refund is sent. Echoed back so the UI can state it rather than assume it. */
  refundTo?: string;
}

export type IntentStatus =
  | 'PENDING_DEPOSIT'
  | 'INCOMPLETE_DEPOSIT'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'REFUNDED'
  | 'FAILED';

export interface IntentStatusResult {
  status: IntentStatus;
  quote?: OneClickResponse['quote'];
  /** Populated once a leg lands. */
  swapDetails?: {
    destinationChainTxHashes?: { hash: string }[];
    originChainTxHashes?: { hash: string }[];
    amountOut?: string;
    amountOutFormatted?: string;
  };
}

/** Raised for anything the service rejects, carrying its own message rather than a generic one. */
export class IntentError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      /**
       * Surface the service's own words.
       *
       * Several of its rejections are *expected states* rather than bugs — "No liquidity available" for a size
       * it cannot fill right now, "Amount is too low for bridge" below the minimum. Replacing those with a
       * generic failure would hide exactly the information the user needs.
       */
      let message = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { message?: string | string[] };
        if (parsed?.message) {
          message = Array.isArray(parsed.message) ? parsed.message.join('; ') : parsed.message;
        }
      } catch {
        /* not JSON; the raw text is the best we have */
      }
      throw new IntentError(message || `1Click returned ${res.status}`);
    }
    return JSON.parse(text) as T;
  } catch (e) {
    if (e instanceof IntentError) throw e;
    const err = e as Error;
    throw new IntentError(
      err.name === 'AbortError' ? 'The intents service did not respond in time.' : err.message
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every asset the service supports.
 *
 * Fetched rather than hardcoded so the app can only ever offer routes that actually exist — the supported set
 * moves, and a hardcoded pair would eventually advertise something that fails at quote time. Cached for the
 * session because it is a large, slow-moving list.
 */
let tokenCache: Promise<IntentToken[]> | null = null;

export function intentTokens(): Promise<IntentToken[]> {
  tokenCache ??= call<IntentToken[]>('/tokens').catch((e) => {
    tokenCache = null; // never cache a failure
    throw e;
  });
  return tokenCache;
}

/** Find one asset by chain + symbol, or null. */
export async function findAsset(blockchain: string, symbol: string): Promise<IntentToken | null> {
  const tokens = await intentTokens();
  return (
    tokens.find(
      (t) =>
        t.blockchain?.toLowerCase() === blockchain.toLowerCase() &&
        t.symbol?.toUpperCase() === symbol.toUpperCase()
    ) ?? null
  );
}

export interface QuoteRequest {
  originAsset: string;
  destinationAsset: string;
  /** Smallest unit of the origin asset. */
  amount: string;
  /** Where a refund goes. Set to the sending address so a refund needs no extra signature. */
  refundTo: string;
  /** Where the output lands. */
  recipient: string;
  /** Basis points. 50 = 0.5%. */
  slippageBps: number;
  /** `true` prices the route without reserving a deposit address. */
  dry: boolean;
}

/**
 * Price a route, and — when `dry` is false — reserve a deposit address.
 *
 * Use `dry: true` for anything shown while the user is still deciding. A non-dry quote reserves an address and
 * starts the 72-hour clock on it, so it should only happen once they have committed.
 */
export async function quote(request: QuoteRequest): Promise<IntentQuote> {
  /**
   * A refund needs somewhere to go, and this is the last place that can still be checked cheaply.
   *
   * If `refundTo` were ever empty the service would either reject the quote or, worse, accept it and have
   * nowhere to return an unfilled deposit. Refusing here converts a possible loss of funds into an error
   * before anything is reserved and before anything is signed.
   */
  if (!request.refundTo || !request.refundTo.trim()) {
    throw new IntentError('Refusing to quote without a refund address.');
  }

  const deadline = new Date(Date.now() + DEADLINE_MS).toISOString();

  const response = await call<OneClickResponse>('/quote', {
    method: 'POST',
    body: JSON.stringify({
      dry: request.dry,
      swapType: 'EXACT_INPUT',
      slippageTolerance: request.slippageBps,
      originAsset: request.originAsset,
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: request.destinationAsset,
      amount: request.amount,
      refundTo: request.refundTo,
      refundType: 'ORIGIN_CHAIN',
      recipient: request.recipient,
      recipientType: 'DESTINATION_CHAIN',
      deadline,
    }),
  });

  // Flatten, so callers never have to know the numbers live one level down.
  return {
    ...response.quote,
    signature: response.signature,
    // Prefer the value the service echoed; fall back to what we asked for.
    refundsAt: response.quoteRequest?.deadline ?? deadline,
    refundTo: request.refundTo,
  };
}

/**
 * Tell the service a deposit is on its way.
 *
 * Explicitly optional — the spec says it only "can speed up swap processing", and funds are auto-detected
 * regardless. It is also the one endpoint that wants auth, so a failure here is ignored rather than surfaced:
 * the swap still completes, just marginally later.
 */
export function notifyDeposit(txHash: string, depositAddress: string): void {
  void call('/deposit/submit', {
    method: 'POST',
    body: JSON.stringify({ txHash, depositAddress }),
  }).catch(() => {
    /* optional by design */
  });
}

/** Where a swap has got to. Polled after the deposit is broadcast. */
export function intentStatus(depositAddress: string): Promise<IntentStatusResult> {
  return call<IntentStatusResult>(`/status?depositAddress=${encodeURIComponent(depositAddress)}`);
}
