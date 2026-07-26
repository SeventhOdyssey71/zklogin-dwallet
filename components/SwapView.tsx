'use client';

/**
 * Move SOL from the dWallet's Solana account into the zkLogin Sui account.
 *
 * WHY THIS IS A PAGE AND NOT A PANEL
 * ----------------------------------
 * It was a single card on the Sui wallet page, which put a cross-chain swap — the one action here that
 * hands money to a third party and cannot be undone — in less space than the send form beneath it. A swap
 * has terms the user should read before agreeing to them: a rate, a guaranteed floor, a fee, a deadline,
 * and a window where a solver network holds the funds. That does not fit in a card, and shrinking it to fit
 * is how people end up agreeing to something they did not read.
 *
 * So it is a flow with the same shape as onboarding: name the destination up front, then one decision per
 * screen. Amount → Review → Settling → Done.
 *
 * WHY THERE ARE NO ADDRESS FIELDS
 * -------------------------------
 * Both ends are already known and neither should be typed: the source and the refund address are the
 * dWallet's Solana account, and the destination is this zkLogin Sui address. A mistyped address here would
 * send funds to a stranger, so the safest input is no input.
 *
 * `refundTo` is deliberately the sending account. If the swap does not fill, the refund lands back where it
 * came from and costs no further signature.
 *
 * WHY IT REUSES THE EXISTING SEND PATH
 * ------------------------------------
 * A deposit is an ordinary SOL transfer to an address the service hands us, so this calls `signWithDWallet`
 * exactly as the send dialog does — same presignature pool, same pre-decrypted key share, same durable
 * nonce. No new signing code exists for this feature at all, which is the whole reason it was worth
 * choosing over a bridge integration.
 */

import { memo, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ArrowDown, Check, ExternalLink, Loader2 } from 'lucide-react';
import { useSuiClient } from '@mysten/dapp-kit';
import { toast } from 'sonner';
import { Button, CopyField, ErrorNote, Skeleton, Stepper, truncate } from '@/components/ui';
import { friendlyError, type FriendlyError } from '@/lib/ui/errors';
import { zkLoginSignAndExecute } from '@/lib/zklogin/execute';
import { peek as peekBalance, subscribe as subscribeBalances } from '@/lib/balances/store';
import { txUrl } from '@/lib/config/chainRegistry';
import {
  findAsset,
  quote,
  notifyDeposit,
  intentStatus,
  type IntentQuote,
  type IntentStatus,
} from '@/lib/intents/oneClick';

/** Slippage the committed quote is allowed to move within. 50bps, tighter than the 100 the service defaults to. */
const SLIPPAGE_BPS = 50;

/** How often to ask where the swap has got to. Settlement measured ~35s, so this is not a tight loop. */
const POLL_MS = 5_000;

/** Give up polling after this. The swap continues regardless; only our watching stops. */
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Amount used to discover the route minimum, in lamports.
 *
 * Deliberately just under the real floor (~1,389,250) rather than trivially small: the service only names
 * the minimum for amounts in that neighbourhood, and answers anything far below it with an unhelpful
 * generic error. Nothing is reserved — the probe is a dry quote.
 */
const MINIMUM_PROBE_LAMPORTS = 1_000_000;

const PHASES = ['Amount', 'Review', 'Settling', 'Done'] as const;

/**
 * Trim a token amount to something readable.
 *
 * The service answers in full precision — "5.240756728 SUI" — which is nine digits of noise around the two
 * that matter. Larger amounts need fewer decimals to be unambiguous, so the cut scales with magnitude, and
 * trailing zeros go because "5.2400" reads as false precision.
 */
function fmtAmount(value: string | number | undefined | null): string {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  if (!Number.isFinite(n)) return '—';
  const decimals = n >= 1000 ? 2 : n >= 1 ? 4 : 6;
  return String(Number(n.toFixed(decimals)));
}

type Phase = 'amount' | 'review' | 'committing' | 'signing' | 'watching' | 'done';

/** Which stepper phase each state belongs to. Settling covers everything from commit to credit. */
const PHASE_INDEX: Record<Phase, number> = {
  amount: 0,
  review: 1,
  committing: 2,
  signing: 2,
  watching: 2,
  done: 3,
};

/** The settling timeline, in order. Each entry lights up as the swap reaches it. */
const TIMELINE: { key: Phase | 'credited'; label: string; detail: string }[] = [
  { key: 'committing', label: 'Reserving', detail: 'Locking the rate and getting a deposit address' },
  { key: 'signing', label: 'Signing', detail: 'Your dWallet signs the SOL transfer' },
  { key: 'watching', label: 'Filling', detail: 'Solvers are filling the order' },
  { key: 'credited', label: 'Credited', detail: 'Native SUI lands in your wallet' },
];

const TIMELINE_ORDER: string[] = TIMELINE.map((t) => t.key);

export const SwapView = memo(function SwapView({
  solanaAddress,
  suiAddress,
  dwalletId,
  dwalletCapId,
  onArrived,
}: {
  solanaAddress: string;
  suiAddress: string;
  dwalletId: string;
  dwalletCapId: string;
  /** Called once SUI has landed, so balances can refresh. */
  onArrived?: () => void;
}) {
  const suiClient = useSuiClient();

  /**
   * The live SOL balance, read from the shared balance store.
   *
   * Taken from the store rather than passed down because it changes on every 30-second poll — threading it
   * as a prop would re-render the whole shell, and this view would then re-render while someone is typing
   * an amount into it.
   */
  const balance = useSyncExternalStore(
    subscribeBalances,
    () => String(peekBalance('Solana', solanaAddress)?.balance ?? ''),
    () => ''
  );
  const available = balance === '' ? null : parseFloat(balance) || 0;

  const [amount, setAmount] = useState('');
  const [phase, setPhase] = useState<Phase>('amount');
  const [preview, setPreview] = useState<IntentQuote | null>(null);
  const [committed, setCommitted] = useState<IntentQuote | null>(null);
  const [status, setStatus] = useState<IntentStatus | null>(null);
  const [statusLine, setStatusLine] = useState('');
  const [error, setError] = useState<FriendlyError | null>(null);
  const [depositTx, setDepositTx] = useState<string | null>(null);
  const [creditTx, setCreditTx] = useState<string | null>(null);
  const [minimum, setMinimum] = useState<number | null>(null);

  const requested = parseFloat(amount) || 0;
  const overBalance = available !== null && requested > available;
  // Compared at full precision; only the DISPLAY is rounded, and upward — see where it is rendered.
  const belowMinimum = minimum !== null && requested > 0 && requested < minimum;

  /**
   * Learn the route's minimum once, before the user has typed anything.
   *
   * The service reports it in the rejection text — but only for amounts NEAR the minimum. Ask for something
   * far below it and the reply is a bare "Failed to get quote" with no number in it, which is how a
   * perfectly ordinary "that's too small" turned into a red failure the user could do nothing about.
   *
   * So the minimum is discovered deliberately rather than by accident: one dry probe at an amount chosen to
   * be under the floor but not absurdly so, which is the range that produces the informative message.
   */
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [sol, sui] = await Promise.all([findAsset('sol', 'SOL'), findAsset('sui', 'SUI')]);
        if (!sol || !sui) return;
        await quote({
          originAsset: sol.assetId,
          destinationAsset: sui.assetId,
          amount: String(MINIMUM_PROBE_LAMPORTS),
          refundTo: solanaAddress,
          recipient: suiAddress,
          slippageBps: SLIPPAGE_BPS,
          dry: true,
        });
        // It priced the probe, so the floor is at or below it. Nothing to warn about.
      } catch (e) {
        const min = /at least (\d+)/.exec((e as Error).message ?? '');
        if (live && min) setMinimum(Number(min[1]) / 1e9);
        // No number in the message: leave `minimum` unknown and report failures as they come.
      }
    })();
    return () => {
      live = false;
    };
  }, [solanaAddress, suiAddress]);

  /**
   * Price the route as the user types, without reserving anything.
   *
   * `dry: true` throughout: a committed quote reserves a deposit address and starts its 72-hour clock,
   * which has no business happening while someone is still deciding on an amount.
   */
  useEffect(() => {
    if (phase !== 'amount') return;
    let live = true;
    /**
     * Clearing happens inside the timer, not synchronously in the effect body. A synchronous setState here
     * cascades a second render on every keystroke — the exact pattern that made inputs elsewhere in this
     * app feel like they caught.
     */
    const timer = setTimeout(async () => {
      if (requested <= 0 || overBalance) {
        if (live) setPreview(null);
        return;
      }
      /**
       * Below a known minimum there is nothing to ask. The service would reject it, and for small enough
       * amounts that rejection carries no explanation — so answering from what we already know is both
       * faster and more useful than relaying the failure.
       */
      if (minimum !== null && requested < minimum) {
        if (live) {
          setPreview(null);
          setError(null);
        }
        return;
      }
      try {
        const [sol, sui] = await Promise.all([findAsset('sol', 'SOL'), findAsset('sui', 'SUI')]);
        if (!sol || !sui) throw new Error('The intents service does not currently list SOL → SUI.');
        const q = await quote({
          originAsset: sol.assetId,
          destinationAsset: sui.assetId,
          amount: String(Math.floor(requested * 10 ** sol.decimals)),
          refundTo: solanaAddress,
          recipient: suiAddress,
          slippageBps: SLIPPAGE_BPS,
          dry: true,
        });
        if (!live) return;
        setPreview(q);
        setError(null);
      } catch (e) {
        if (!live) return;
        setPreview(null);
        const message = (e as Error).message ?? '';
        const min = /at least (\d+)/.exec(message);
        if (min) {
          setMinimum(Number(min[1]) / 1e9);
          setError(null);
        } else {
          setError(friendlyError(e));
        }
      }
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [phase, requested, overBalance, minimum, solanaAddress, suiAddress]);

  const watch = useCallback(
    async (depositAddress: string) => {
      const until = Date.now() + POLL_TIMEOUT_MS;
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        let result: Awaited<ReturnType<typeof intentStatus>>;
        try {
          result = await intentStatus(depositAddress);
        } catch {
          if (Date.now() > until) break;
          continue; // a failed poll is not a failed swap
        }
        setStatus(result.status);
        setCreditTx(result.swapDetails?.destinationChainTxHashes?.[0]?.hash ?? null);

        if (result.status === 'SUCCESS') {
          setPhase('done');
          toast.success('SUI arrived', { description: 'Your Sui wallet has been credited.' });
          onArrived?.();
          return;
        }
        if (result.status === 'REFUNDED' || result.status === 'FAILED') {
          setPhase('done');
          return;
        }
        if (Date.now() > until) break;
      }
      // Timed out watching. The swap is still live — say so rather than implying failure.
      setStatusLine(
        'Still processing. This can take longer than usual; your funds are not lost and the service will ' +
          'either complete the swap or refund automatically.'
      );
    },
    [onArrived]
  );

  /**
   * Commit the quote, sign the deposit, then watch.
   *
   * Only reached from the review screen, so by here the user has seen the terms. The commit and the
   * signature are one act from their point of view — a reserved deposit address with nothing sent to it is
   * not a state worth stopping in.
   */
  const confirm = async () => {
    setError(null);
    setPhase('committing');
    setStatusLine('Locking the rate…');
    try {
      const [sol, sui] = await Promise.all([findAsset('sol', 'SOL'), findAsset('sui', 'SUI')]);
      if (!sol || !sui) throw new Error('The intents service does not currently list SOL → SUI.');

      const live = await quote({
        originAsset: sol.assetId,
        destinationAsset: sui.assetId,
        amount: String(Math.floor(requested * 10 ** sol.decimals)),
        refundTo: solanaAddress,
        recipient: suiAddress,
        slippageBps: SLIPPAGE_BPS,
        dry: false,
      });
      if (!live.depositAddress) {
        throw new Error('The intents service did not return a deposit address.');
      }
      setCommitted(live);

      setPhase('signing');
      setStatusLine('Signing the transfer with your dWallet…');

      // An ordinary SOL transfer. Same pipeline as any other send.
      const { signWithDWallet, broadcastTransaction } = await import(
        '@/lib/dwallet/clientSideSigning'
      );
      const signed = await signWithDWallet({
        dwalletId,
        dwalletCapId,
        encryptedShareId: '',
        chain: 'Solana',
        recipient: live.depositAddress,
        // The exact committed amount — an underpayment is refunded rather than filled.
        amount: String(Number(live.amountInFormatted ?? amount)),
        suiClient,
        userAccount: { address: suiAddress },
        signAndExecuteTransaction: (p: { transaction: unknown }) =>
          zkLoginSignAndExecute(suiClient, suiAddress, p as never),
        onProgress: setStatusLine,
      });

      const hash = signed.serialized
        ? (await broadcastTransaction('Solana', signed.serialized)).txHash
        : signed.txHash || signed.hash;
      setDepositTx(hash);

      // Optional, and free: it only speeds up detection.
      notifyDeposit(hash, live.depositAddress);

      setPhase('watching');
      setStatus('PENDING_DEPOSIT');
      setStatusLine('Deposit sent. Solvers are filling it…');
      await watch(live.depositAddress);
    } catch (e) {
      console.error(e);
      setError(friendlyError(e));
      // Back to review, not to the start: the amount is still what they wanted.
      setPhase('review');
      setStatusLine('');
    }
  };

  const reset = () => {
    setPhase('amount');
    setPreview(null);
    setCommitted(null);
    setStatus(null);
    setStatusLine('');
    setDepositTx(null);
    setCreditTx(null);
    setAmount('');
    setError(null);
  };

  const settling = phase === 'committing' || phase === 'signing' || phase === 'watching';
  const terms = committed ?? preview;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Swap to Sui</h1>
        <p className="mono-label mt-1">SOLANA → SUI · VIA NEAR INTENTS</p>
      </div>

      <Stepper phases={PHASES} current={PHASE_INDEX[phase]} label="Swap progress" />

      {/* The route, shown on every screen: what leaves, and what arrives where. */}
      <div className="card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="mono-label">From · your Solana dWallet</p>
            <p className="text-sm num truncate mt-0.5">{truncate(solanaAddress, 8, 6)}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="mono-label">Available</p>
            <p className="text-sm num mt-0.5">
              {available === null ? <Skeleton className="h-3 w-16" /> : `${available} SOL`}
            </p>
          </div>
        </div>
        <div className="my-3 flex items-center gap-2">
          <span className="h-px flex-1 bg-[var(--border)]" aria-hidden />
          <ArrowDown className="w-3.5 h-3.5 text-[var(--muted-2)]" aria-hidden />
          <span className="h-px flex-1 bg-[var(--border)]" aria-hidden />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="mono-label">To · your Sui wallet</p>
            <p className="text-sm num truncate mt-0.5">{truncate(suiAddress, 8, 6)}</p>
          </div>
          <p className="mono-label shrink-0">native SUI</p>
        </div>
      </div>

      {phase === 'amount' && (
        <div className="card p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <label htmlFor="swap-amount" className="mono-label">
              Amount to swap
            </label>
            {available !== null && available > 0 && (
              <button
                type="button"
                onClick={() => setAmount(String(Number((available * 0.98).toFixed(6))))}
                title="Leaves a little SOL behind for the transfer fee"
                className="mono-label hover:text-[var(--foreground)] transition"
              >
                Max
              </button>
            )}
          </div>
          <div className="relative">
            <input
              id="swap-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              className={`w-full pl-3 pr-14 py-3 rounded-[var(--radius-sm)] bg-[var(--surface-2)] border text-lg outline-none transition num ${
                overBalance || belowMinimum
                  ? 'border-[var(--danger-border)]'
                  : 'border-[var(--border)] focus:border-[var(--border-strong)]'
              }`}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 mono-label pointer-events-none">
              SOL
            </span>
          </div>

          {overBalance && (
            <p className="text-xs text-[var(--danger)]">More than this account holds.</p>
          )}
          {/* Rounded UP: showing a truncated minimum would name an amount that still gets rejected. */}
          {belowMinimum && (
            <p className="text-xs text-[var(--danger)]">
              Below the service minimum of {Math.ceil(minimum! * 1e6) / 1e6} SOL.
            </p>
          )}

          {preview && (
            <div className="rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-3 space-y-1.5">
              <Row label="You receive" value={`≈ ${fmtAmount(preview.amountOutFormatted)} SUI`} strong />
              <Row label="Estimated time" value={`~${preview.timeEstimate ?? 35}s`} />
            </div>
          )}

          {error && <ErrorNote {...error} />}

          <Button
            onClick={() => setPhase('review')}
            disabled={!preview || overBalance || belowMinimum || requested <= 0}
            className="w-full"
          >
            Review swap
          </Button>
        </div>
      )}

      {phase === 'review' && (
        <div className="card p-4 space-y-3">
          <h2 className="font-bold text-sm">Review</h2>
          <div className="rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-3 space-y-1.5">
            <Row label="You send" value={`${fmtAmount(requested)} SOL`} strong />
            <Row label="You receive" value={`≈ ${fmtAmount(preview?.amountOutFormatted)} SUI`} strong />
            <Row
              label="Guaranteed minimum"
              value={
                preview?.minAmountOut
                  ? `${fmtAmount(Number(preview.minAmountOut) / 1e9)} SUI`
                  : '—'
              }
            />
            <Row label="Max slippage" value={`${SLIPPAGE_BPS / 100}%`} />
            <Row label="Estimated time" value={`~${preview?.timeEstimate ?? 35}s`} />
          </div>

          {/*
            The trust model, stated plainly rather than buried. Between the deposit landing and the fill
            arriving, a solver network holds the funds — that is the real risk here and the user is
            entitled to see it before agreeing, not after.
          */}
          <p className="text-[11px] text-[var(--muted)] leading-relaxed">
            The rate is locked when you confirm. Your SOL goes to a deposit address the service reserves for
            this swap, and solvers fill it — so between sending and being credited, they hold the funds. If
            no one fills it, your SOL is refunded automatically to the account it came from. Native SUI, no
            wrapped assets.
          </p>

          {error && <ErrorNote {...error} />}

          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setPhase('amount')} className="flex-1">
              Back
            </Button>
            <Button onClick={confirm} className="flex-1">
              Confirm and send
            </Button>
          </div>
        </div>
      )}

      {settling && (
        <div className="card p-4 space-y-3">
          <ol className="space-y-2.5">
            {TIMELINE.map((step) => {
              const at = TIMELINE_ORDER.indexOf(phase);
              const mine = TIMELINE_ORDER.indexOf(step.key);
              const done = mine < at;
              const active = mine === at;
              return (
                <li key={step.key} className="flex items-start gap-2.5">
                  <span className="w-4 h-4 mt-0.5 shrink-0 grid place-items-center">
                    {done ? (
                      <Check className="w-3.5 h-3.5 text-[var(--success)]" aria-hidden />
                    ) : active ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--border-strong)]" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={`text-sm block ${active ? '' : done ? 'text-[var(--muted)]' : 'text-[var(--muted-2)]'}`}
                    >
                      {step.label}
                    </span>
                    {active && (
                      <span className="text-[11px] text-[var(--muted)] block mt-0.5">
                        {statusLine || step.detail}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>

          {depositTx && (
            <CopyField
              label="Deposit transaction"
              value={depositTx}
              href={txUrl('Solana', depositTx) ?? undefined}
            />
          )}
          {terms?.deadline && phase === 'watching' && (
            <p className="text-[11px] text-[var(--muted)]">
              Leaving this page does not cancel the swap — it settles on its own.
            </p>
          )}
        </div>
      )}

      {phase === 'done' && (
        <div className="card p-4 space-y-3">
          {status === 'SUCCESS' && (
            <>
              <p className="text-sm text-[var(--success)]">SUI has landed in your Sui wallet.</p>
              {creditTx && (
                <CopyField
                  label="Sui transaction"
                  value={creditTx}
                  href={txUrl('Sui', creditTx) ?? undefined}
                />
              )}
            </>
          )}
          {status === 'REFUNDED' && (
            <p className="text-sm text-[var(--warning)]">
              No solver filled the order, so your SOL was refunded to the account it came from. Nothing was
              lost beyond the network fee.
            </p>
          )}
          {status === 'FAILED' && (
            <ErrorNote
              message="The swap failed."
              action="Your SOL is refunded automatically to the sending account. Nothing further is needed."
              raw="status: FAILED"
            />
          )}
          {statusLine && status !== 'SUCCESS' && (
            <p className="text-sm text-[var(--muted)]">{statusLine}</p>
          )}
          {depositTx && (
            <CopyField
              label="Deposit transaction"
              value={depositTx}
              href={txUrl('Solana', depositTx) ?? undefined}
            />
          )}
          <Button variant="secondary" onClick={reset} className="w-full">
            Swap again
          </Button>
        </div>
      )}

      <p className="text-[11px] text-[var(--muted-2)] text-center">
        Powered by NEAR Intents.{' '}
        <a
          href="https://docs.near-intents.org"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-[var(--muted)] inline-flex items-center gap-1"
        >
          How it works
          <ExternalLink className="w-3 h-3" aria-hidden />
        </a>
      </p>
    </div>
  );
});

/** One line of a terms table. `strong` marks the two numbers the decision actually turns on. */
function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="mono-label">{label}</span>
      <span className={`num ${strong ? 'text-sm font-bold' : 'text-xs text-[var(--muted)]'}`}>
        {value}
      </span>
    </div>
  );
}
