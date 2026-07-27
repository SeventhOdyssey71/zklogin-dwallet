'use client';

/**
 * Swap between the dWallet's Solana account and the zkLogin Sui account, in either direction.
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
 * Both ends are already known and neither should be typed: the two accounts are this wallet's own, and
 * the refund always goes back to whichever one is paying. A mistyped address here would send funds to a
 * stranger, so the safest input is no input.
 *
 * WHY IT REUSES THE EXISTING SEND PATHS
 * -------------------------------------
 * A deposit is an ordinary transfer to an address the service hands us, so each direction calls the code
 * that already exists for it — `signWithDWallet` for Solana, `zkLoginSignAndExecute` for Sui. No signing
 * code was written for this feature at all, which is the whole reason it was worth choosing over a bridge
 * integration. See `ROUTES` for why that makes the two directions cost wildly different amounts.
 */

import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDown, Check, ExternalLink, Loader2 } from 'lucide-react';
import { useSuiClient } from '@mysten/dapp-kit';
import { toast } from 'sonner';
import { Button, CopyField, ErrorNote, Skeleton, Stepper, truncate } from '@/components/ui';
import { friendlyError, type FriendlyError } from '@/lib/ui/errors';
import { prewarmZkLoginProof, zkLoginSignAndExecute } from '@/lib/zklogin/execute';
import { warmSendPath } from '@/lib/ika/warmSendPath';
import { Timings } from '@/lib/dwallet/core/timings';
import { peek as peekBalance, subscribe as subscribeBalances } from '@/lib/balances/store';
import { txUrl } from '@/lib/config/chainRegistry';
import {
  SUI_COIN_TYPE,
  buildSuiSendTransaction,
  fetchSuiWalletAssets,
  formatUnits,
  maxSendable,
  toBaseUnits,
  type SuiAsset,
} from '@/lib/sui/sendSui';
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

/**
 * How often to ask where the swap has got to.
 *
 * The first version slept 5s BEFORE its first question and then asked every 5s, so a swap that settled
 * in 22s was reported somewhere between 25s and 30s — up to 8s of the wait was our own polling rather
 * than the network. Asking immediately, and quickly while settlement is plausible, removes that without
 * turning a ten-minute watch into thousands of requests.
 */
const POLL_FAST_MS = 1_500;
const POLL_SLOW_MS = 5_000;

/** How long to keep asking quickly. Settlement measured 22–35s, so this covers the expected window. */
const POLL_FAST_WINDOW_MS = 60_000;

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

export type Direction = 'solToSui' | 'suiToSol';

/**
 * What differs between the two directions — and, more importantly, what does not.
 *
 * Both are the same intent: send the origin asset to an address the service reserves, and let solvers
 * deliver the destination asset. Only the deposit leg differs, and it differs a lot:
 *
 *   SOL → SUI  the deposit is a Solana transfer, so it needs a dWallet signature — presignature, key
 *              share, wasm sign request, MPC round. Measured at 28.2s before the transfer even goes out.
 *   SUI → SOL  the deposit is a Sui transfer from the zkLogin wallet itself, signed with the ephemeral
 *              key. No dWallet, no MPC, no wasm. It is the same code path as the wallet's own withdraw
 *              form, which is why this direction is the fastest thing in the app.
 *
 * Keeping that asymmetry in one table rather than in branches through the flow is what stops the two
 * directions drifting into two implementations.
 */
const ROUTES: Record<
  Direction,
  {
    /** (blockchain, symbol) as the intents service lists them. */
    origin: [string, string];
    destination: [string, string];
    fromChain: string;
    toChain: string;
    fromSymbol: string;
    toSymbol: string;
    /** What signs the deposit, in the user's words. */
    signerLabel: string;
    fromLabel: string;
    toLabel: string;
  }
> = {
  solToSui: {
    origin: ['sol', 'SOL'],
    destination: ['sui', 'SUI'],
    fromChain: 'Solana',
    toChain: 'Sui',
    fromSymbol: 'SOL',
    toSymbol: 'SUI',
    signerLabel: 'Your Solana wallet signs the transfer',
    fromLabel: 'your Solana wallet',
    toLabel: 'your Sui wallet',
  },
  suiToSol: {
    origin: ['sui', 'SUI'],
    destination: ['sol', 'SOL'],
    fromChain: 'Sui',
    toChain: 'Solana',
    fromSymbol: 'SUI',
    toSymbol: 'SOL',
    signerLabel: 'Your Sui wallet signs the transfer',
    fromLabel: 'your Sui wallet',
    toLabel: 'your Solana wallet',
  },
};

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
  // `detail` for this step is supplied per direction — a Sui deposit involves no dWallet at all.
  { key: 'signing', label: 'Signing', detail: '' },
  { key: 'watching', label: 'Filling', detail: 'Solvers are filling the order' },
  { key: 'credited', label: 'Credited', detail: '' },
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
  const [direction, setDirection] = useState<Direction>('solToSui');
  const route = ROUTES[direction];
  const sendingSol = direction === 'solToSui';

  /** Source and destination follow the direction; the refund always goes back to the source. */
  const fromAddress = sendingSol ? solanaAddress : suiAddress;
  const toAddress = sendingSol ? suiAddress : solanaAddress;

  /**
   * The live SOL balance, read from the shared balance store.
   *
   * Taken from the store rather than passed down because it changes on every 30-second poll — threading it
   * as a prop would re-render the whole shell, and this view would then re-render while someone is typing
   * an amount into it.
   */
  const solBalance = useSyncExternalStore(
    subscribeBalances,
    () => String(peekBalance('Solana', solanaAddress)?.balance ?? ''),
    () => ''
  );

  /**
   * The SUI side is read directly rather than from the balance store.
   *
   * The store tracks dWallet chains; the zkLogin Sui account is not one of them. More importantly, SUI
   * pays its own gas, so the number that matters is not the balance but `maxSendable` — the balance minus
   * the gas reserve. Reusing the wallet's own helper means the swap and the withdraw form can never
   * disagree about what is spendable.
   */
  const [suiAsset, setSuiAsset] = useState<SuiAsset | null>(null);
  /** Bumped after a swap settles, so the spendable balance reflects what just left. */
  const [balanceNonce, setBalanceNonce] = useState(0);
  useEffect(() => {
    if (sendingSol) return;
    let live = true;
    void fetchSuiWalletAssets(suiClient, suiAddress)
      .then((assets) => {
        const sui = assets.find((a) => a.type === SUI_COIN_TYPE) ?? null;
        if (live) setSuiAsset(sui);
      })
      .catch(() => {
        /* leaves the balance unknown, which only hides the Max button */
      });
    return () => {
      live = false;
    };
  }, [sendingSol, suiClient, suiAddress, balanceNonce]);

  const available = sendingSol
    ? solBalance === ''
      ? null
      : parseFloat(solBalance) || 0
    : suiAsset
      ? Number(formatUnits(maxSendable(suiAsset), suiAsset.decimals))
      : null;

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
  /** When the confirm was pressed, for the elapsed clock. Captured in the handler, never in render. */
  const [startedAt, setStartedAt] = useState<number | null>(null);

  /**
   * Warm the signing path the moment this page is open.
   *
   * The measured swap spent 423ms buying a presignature inline and 12.4s in `sign tx (zkLogin submit)`,
   * which mints the Groth16 proof. Neither depends on the amount or the deposit address, so neither
   * belongs between pressing Confirm and the transfer going out. Landing on this page is intent enough.
   *
   * Re-warmed on entering Review as well: someone can sit on the amount field long enough for the banked
   * presignature to have been spent by a send in another tab.
   */
  const warmed = useRef(false);
  useEffect(() => {
    if (phase !== 'amount' && phase !== 'review') return;
    if (phase === 'amount' && warmed.current) return;
    warmed.current = true;

    /**
     * BOTH directions need the Groth16 proof.
     *
     * This was wrong until a measured run showed it. A Sui deposit needs no dWallet and no MPC, so
     * warming was skipped for that direction entirely — but the transfer is still submitted through
     * `zkLoginSignAndExecute`, which mints the proof. Skipping the warm-up put ~2-4s back onto the
     * critical path of the direction that was supposed to be the fast one.
     */
    void prewarmZkLoginProof();

    /**
     * Only the Solana deposit needs a dWallet signature — presignature, key share, wasm, MPC round.
     * A Sui deposit is signed with the ephemeral key already in memory.
     */
    if (sendingSol) {
      void warmSendPath({ suiClient, zkAddress: suiAddress, dwalletId, chain: 'Solana' });
    }
  }, [sendingSol, phase, suiClient, suiAddress, dwalletId]);

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
        const [from, to] = await Promise.all([
          findAsset(...route.origin),
          findAsset(...route.destination),
        ]);
        if (!from || !to) return;
        await quote({
          originAsset: from.assetId,
          destinationAsset: to.assetId,
          amount: String(MINIMUM_PROBE_LAMPORTS),
          refundTo: fromAddress,
          recipient: toAddress,
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
    // Re-probed per direction: the two routes have different floors.
  }, [route, fromAddress, toAddress]);

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
        const [from, to] = await Promise.all([
          findAsset(...route.origin),
          findAsset(...route.destination),
        ]);
        if (!from || !to) {
          throw new Error(
            `The intents service does not currently list ${route.fromSymbol} → ${route.toSymbol}.`
          );
        }
        const q = await quote({
          originAsset: from.assetId,
          destinationAsset: to.assetId,
          amount: String(Math.floor(requested * 10 ** from.decimals)),
          refundTo: fromAddress,
          recipient: toAddress,
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
  }, [phase, requested, overBalance, minimum, route, fromAddress, toAddress]);

  const watch = useCallback(
    async (depositAddress: string) => {
      const startedWatching = Date.now();
      const until = startedWatching + POLL_TIMEOUT_MS;
      let first = true;
      for (;;) {
        // Ask straight away the first time: the deposit is already broadcast and may already be filled.
        if (!first) {
          const fast = Date.now() - startedWatching < POLL_FAST_WINDOW_MS;
          await new Promise((r) => setTimeout(r, fast ? POLL_FAST_MS : POLL_SLOW_MS));
        }
        first = false;
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
    setStartedAt(Date.now());
    setPhase('committing');
    setStatusLine('Locking the rate…');
    /**
     * Time the swap the way the send path is timed.
     *
     * "40 seconds one way, 67 the other" is not a debuggable report — it cannot separate our own latency
     * from the solver network's, and the first real runs of this flow could only be guessed at. The send
     * path already learned this; the swap shipped without it.
     */
    const T = new Timings(`Swap ${route.fromSymbol} → ${route.toSymbol}`);
    try {
      const [from, to] = await T.step('asset lookup', () =>
        Promise.all([findAsset(...route.origin), findAsset(...route.destination)])
      );
      if (!from || !to) {
        throw new Error(
          `The intents service does not currently list ${route.fromSymbol} → ${route.toSymbol}.`
        );
      }

      const live = await T.step('commit quote', () =>
        quote({
          originAsset: from.assetId,
          destinationAsset: to.assetId,
          amount: String(Math.floor(requested * 10 ** from.decimals)),
          refundTo: fromAddress,
          recipient: toAddress,
          slippageBps: SLIPPAGE_BPS,
          dry: false,
        })
      );
      if (!live.depositAddress) {
        throw new Error('The intents service did not return a deposit address.');
      }
      setCommitted(live);

      setPhase('signing');
      setStatusLine('Signing the transfer…');

      /**
       * The exact committed amount — an underpayment is refunded rather than filled.
       */
      const depositAmount = String(Number(live.amountInFormatted ?? amount));
      let hash: string;

      if (sendingSol) {
        /**
         * A Solana deposit is an ordinary SOL transfer, so this is the same pipeline as any other send:
         * presignature pool, pre-decrypted key share, durable nonce. No signing code is specific to swaps.
         */
        const { signWithDWallet, broadcastTransaction } = await import(
          '@/lib/dwallet/clientSideSigning'
        );
        const signed = await T.step('sign deposit (dWallet + MPC)', () =>
          signWithDWallet({
            dwalletId,
            dwalletCapId,
            encryptedShareId: '',
            chain: 'Solana',
            recipient: live.depositAddress!,
            amount: depositAmount,
            suiClient,
            userAccount: { address: suiAddress },
            signAndExecuteTransaction: (p: { transaction: unknown }) =>
              zkLoginSignAndExecute(suiClient, suiAddress, p as never),
            onProgress: setStatusLine,
          })
        );
        hash = signed.serialized
          ? await T.step(
              'broadcast',
              async () => (await broadcastTransaction('Solana', signed.serialized!)).txHash
            )
          : signed.txHash || signed.hash;
      } else {
        /**
         * A Sui deposit needs no dWallet at all.
         *
         * The money is already in the zkLogin account, so the transfer is signed with the ephemeral key
         * directly — the same path as the wallet's withdraw form. That skips the presignature, the key
         * share, the wasm sign request and the MPC round, which together were 28.2s of the measured
         * SOL → SUI swap. This direction is a single Sui transaction.
         */
        if (!suiAsset) throw new Error('Still reading your SUI balance — try again in a moment.');
        const tx = buildSuiSendTransaction({
          asset: suiAsset,
          amountBaseUnits: toBaseUnits(depositAmount, suiAsset.decimals),
          recipient: live.depositAddress,
          sender: suiAddress,
        });
        const { digest } = await T.step('sign deposit (zkLogin)', () =>
          zkLoginSignAndExecute(suiClient, suiAddress, { transaction: tx })
        );
        hash = digest;
      }

      setDepositTx(hash);

      // Optional, and free: it only speeds up detection.
      notifyDeposit(hash, live.depositAddress);

      setPhase('watching');
      setStatus('PENDING_DEPOSIT');
      setStatusLine('Deposit sent. Solvers are filling it…');
      await T.step('solver settlement', () => watch(live.depositAddress!));
      T.report();
    } catch (e) {
      // Report on the way out too: a slow failure is exactly the case worth seeing a breakdown for.
      T.report();
      console.error(e);
      setError(friendlyError(e));
      // Back to review, not to the start: the amount is still what they wanted.
      setPhase('review');
      setStatusLine('');
    }
  };

  /**
   * Change direction, discarding everything the old one implied.
   *
   * The quote, the learned minimum and any priced preview all belong to one asset pair. Keeping the
   * typed amount would be worse than useless — 0.05 is a sensible amount of SOL and a dust amount of
   * SUI — so the form starts clean.
   */
  const switchDirection = (next: Direction) => {
    if (next === direction) return;
    setDirection(next);
    setAmount('');
    setPreview(null);
    setMinimum(null);
    setError(null);
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
    setStartedAt(null);
    setBalanceNonce((n) => n + 1);
  };

  const settling = phase === 'committing' || phase === 'signing' || phase === 'watching';
  const terms = committed ?? preview;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Swap</h1>
          <p className="mono-label mt-1">
            {route.fromChain} → {route.toChain} · VIA NEAR INTENTS
          </p>
        </div>

        {/*
          Direction is a choice, not a setting, so it sits next to the title rather than in the form.
          Disabled once anything is in flight: the quote, the deposit address and the signature all
          belong to one direction, and switching mid-flow would silently invalidate all three.
        */}
        <div
          role="group"
          aria-label="Swap direction"
          className="flex rounded-[var(--radius-sm)] border border-[var(--border)] overflow-hidden shrink-0"
        >
          {(['solToSui', 'suiToSol'] as Direction[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => switchDirection(d)}
              disabled={phase !== 'amount'}
              aria-pressed={direction === d}
              className={`px-3 py-1.5 mono-label transition disabled:opacity-40 disabled:cursor-not-allowed ${
                direction === d
                  ? 'bg-[var(--foreground)] text-black'
                  : 'hover:text-[var(--foreground)] cursor-pointer'
              }`}
            >
              {ROUTES[d].fromSymbol} → {ROUTES[d].toSymbol}
            </button>
          ))}
        </div>
      </div>

      <Stepper phases={PHASES} current={PHASE_INDEX[phase]} label="Swap progress" />

      {/* The route, shown on every screen: what leaves, and what arrives where. */}
      <div className="card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="mono-label">From · {route.fromLabel}</p>
            <p className="text-sm num truncate mt-0.5">{truncate(fromAddress, 8, 6)}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="mono-label">Available</p>
            <p className="text-sm num mt-0.5">
              {available === null ? (
                <Skeleton className="h-3 w-16" />
              ) : (
                `${fmtAmount(available)} ${route.fromSymbol}`
              )}
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
            <p className="mono-label">To · {route.toLabel}</p>
            <p className="text-sm num truncate mt-0.5">{truncate(toAddress, 8, 6)}</p>
          </div>
          <p className="mono-label shrink-0">native {route.toSymbol}</p>
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
              {route.fromSymbol}
            </span>
          </div>

          {overBalance && (
            <p className="text-xs text-[var(--danger)]">More than this account holds.</p>
          )}
          {/* Rounded UP: showing a truncated minimum would name an amount that still gets rejected. */}
          {belowMinimum && (
            <p className="text-xs text-[var(--danger)]">
              Below the service minimum of {Math.ceil(minimum! * 1e6) / 1e6} {route.fromSymbol}.
            </p>
          )}

          {preview && (
            <div className="rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-3 space-y-1.5">
              <Row
                label="You receive"
                value={`≈ ${fmtAmount(preview.amountOutFormatted)} ${route.toSymbol}`}
                strong
              />
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
            <Row label="You send" value={`${fmtAmount(requested)} ${route.fromSymbol}`} strong />
            <Row
              label="You receive"
              value={`≈ ${fmtAmount(preview?.amountOutFormatted)} ${route.toSymbol}`}
              strong
            />
            <Row
              label="Guaranteed minimum"
              value={
                preview?.minAmountOut
                  ? `${fmtAmount(Number(preview.minAmountOut) / 1e9)} ${route.toSymbol}`
                  : '—'
              }
            />
            <Row label="Max slippage" value={`${SLIPPAGE_BPS / 100}%`} />
            <Row label="Estimated time" value={`~${preview?.timeEstimate ?? 35}s`} />
            {/* Named, not implied: this is the promise that makes the risk above acceptable. */}
            <Row label="Refunds to" value={truncate(fromAddress, 6, 6)} />
          </div>

          {/*
            The trust model, stated plainly rather than buried. Between the deposit landing and the fill
            arriving, a solver network holds the funds — that is the real risk here and the user is
            entitled to see it before agreeing, not after.
          */}
          <p className="text-[11px] text-[var(--muted)] leading-relaxed">
            The rate is locked when you confirm. Your {route.fromSymbol} goes to a deposit address the
            service reserves for this swap, and solvers fill it — so between sending and being credited,
            they hold the funds. If no one fills it, your {route.fromSymbol} is refunded automatically to
            the account it came from. Native {route.toSymbol}, no wrapped assets.
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
          <div className="flex items-baseline justify-between">
            <span className="mono-label">Elapsed</span>
            <span className="text-sm">
              {startedAt !== null && <Elapsed since={startedAt} />}
              <span className="mono-label ml-2">of ~{preview?.timeEstimate ?? 35}s expected</span>
            </span>
          </div>
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
                        {statusLine ||
                          step.detail ||
                          (step.key === 'signing'
                            ? route.signerLabel
                            : `Native ${route.toSymbol} lands in ${route.toLabel}`)}
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
              href={txUrl(route.fromChain, depositTx) ?? undefined}
            />
          )}
          {phase === 'watching' && (
            <>
              {terms?.refundsAt && (
                <div className="flex items-baseline justify-between rounded-[var(--radius-sm)] bg-[var(--surface-2)] px-3 py-2">
                  <span className="mono-label">Auto-refund in</span>
                  <span className="text-sm">
                    <Countdown to={terms.refundsAt} />
                    <span className="mono-label ml-2">to {truncate(solanaAddress, 6, 6)}</span>
                  </span>
                </div>
              )}
              <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                Leaving this page does not cancel the swap — it settles on its own, and an unfilled order
                refunds to {route.fromLabel} without any further signature from you.
              </p>
            </>
          )}
        </div>
      )}

      {phase === 'done' && (
        <div className="card p-4 space-y-3">
          {status === 'SUCCESS' && (
            <>
              <p className="text-sm text-[var(--success)]">
                {route.toSymbol} has landed in {route.toLabel}.
              </p>
              {creditTx && (
                <CopyField
                  label={`${route.toChain} transaction`}
                  value={creditTx}
                  href={txUrl(route.toChain, creditTx) ?? undefined}
                />
              )}
            </>
          )}
          {status === 'REFUNDED' && (
            <p className="text-sm text-[var(--warning)]">
              No solver filled the order, so your {route.fromSymbol} was refunded to{' '}
              {truncate(fromAddress, 6, 6)} — the account it came from. Nothing was lost beyond the
              network fee.
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
              href={txUrl(route.fromChain, depositTx) ?? undefined}
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

/**
 * Seconds since a start point, as m:ss.
 *
 * A leaf on purpose. It re-renders once a second, and anything it is mixed into re-renders with it — the
 * same mistake that made the balance list, and the send dialog inside it, stutter at 1Hz.
 *
 * The clock is in state rather than read during render: `Date.now()` in a render body makes the render
 * impure, since the same props would produce a different result on every call.
 */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    /**
     * Corrected immediately, then every second.
     *
     * State starts at `since` so the first render is pure, which reads 0:00 — right when the clock starts
     * with the swap, wrong if this remounts partway through (switching tabs and back). The zero-delay
     * timeout fixes that within the frame; a setState in the effect body would cascade a second render.
     */
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, 1_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  return (
    <span className="num tabular-nums">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  );
}

/**
 * Time left before an unfilled swap refunds, counted down.
 *
 * Shown once there is money in flight, because that is when "how long can this go on?" becomes the
 * question. It is a promise, not a warning: reaching zero means the funds come back.
 */
function Countdown({ to }: { to: string }) {
  const target = new Date(to).getTime();
  const [now, setNow] = useState(target);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    /**
     * The first correction is scheduled, not synchronous.
     *
     * State starts at `target` so the first render is pure and needs no clock, but that renders zero — so
     * it has to be corrected immediately rather than a second later. A zero-delay timeout does that within
     * the same frame without a setState inside the effect body, which would cascade a second render.
     */
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, 1_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);
  if (!Number.isFinite(target)) return null;
  const left = Math.max(0, target - now);
  if (left === 0) return <span className="num">refunding</span>;
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return (
    <span className="num tabular-nums">
      {m}:{String(s).padStart(2, '0')}
    </span>
  );
}

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
