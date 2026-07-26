'use client';

/**
 * Move SOL from the dWallet's Solana account into the zkLogin Sui account.
 *
 * WHY THIS LIVES ON THE SUI WALLET PAGE
 * ------------------------------------
 * The Sui account is what pays for everything — SUI for gas, IKA for 2PC-MPC session fees — so "I have value
 * on Solana and no SUI to sign with" is the problem this solves. Putting it next to the balances that run out
 * is where someone will actually look for it.
 *
 * WHY IT NEEDS NO ADDRESS FIELDS
 * ------------------------------
 * Both ends are already known and neither should be typed: the source and the refund address are the dWallet's
 * Solana account, and the destination is this zkLogin Sui address. A mistyped address here would send funds to
 * a stranger, so the safest input is no input.
 *
 * `refundTo` is deliberately the sending account. If the swap does not fill, the refund lands back where it
 * came from and costs no further signature.
 *
 * HOW IT REUSES THE EXISTING SEND PATH
 * ------------------------------------
 * A deposit is an ordinary SOL transfer to an address the service hands us, so this calls `signWithDWallet`
 * exactly as the send dialog does — same presignature pool, same pre-decrypted key share, same durable nonce.
 * No new signing code exists for this feature at all, which is the whole reason it was worth choosing over a
 * bridge integration.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ArrowDownToLine, ExternalLink } from 'lucide-react';
import { useSuiClient } from '@mysten/dapp-kit';
import { toast } from 'sonner';
import { Button, CopyField, ErrorNote, Skeleton, StatusNote } from '@/components/ui';
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

type Phase = 'idle' | 'quoting' | 'signing' | 'watching' | 'done';

export function MoveSolToSui({
  solanaAddress,
  suiAddress,
  solBalance,
  dwalletId,
  dwalletCapId,
  onArrived,
}: {
  solanaAddress: string;
  suiAddress: string;
  /** Formatted SOL balance, or null while loading. */
  solBalance: string | null;
  dwalletId: string;
  dwalletCapId: string;
  /** Called once SUI has landed, so balances can refresh. */
  onArrived?: () => void;
}) {
  const suiClient = useSuiClient();

  /**
   * The live SOL balance, read from the shared balance store.
   *
   * Taken from the store rather than passed down because it changes on every 30-second poll — threading it as a
   * prop would re-render the whole shell, and this panel would then re-render while someone is typing an
   * amount into it. `solBalance` remains an override for callers that already hold a value.
   */
  const storeVersion = useSyncExternalStore(
    subscribeBalances,
    () => String(peekBalance('Solana', solanaAddress)?.balance ?? ''),
    () => ''
  );
  const liveBalance = solBalance ?? (storeVersion === '' ? null : storeVersion);

  const [amount, setAmount] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState<IntentQuote | null>(null);
  const [status, setStatus] = useState<IntentStatus | null>(null);
  const [statusLine, setStatusLine] = useState('');
  const [error, setError] = useState<FriendlyError | null>(null);
  const [depositTx, setDepositTx] = useState<string | null>(null);
  const [minimum, setMinimum] = useState<number | null>(null);

  const available = liveBalance === null ? null : parseFloat(liveBalance) || 0;
  const requested = parseFloat(amount) || 0;
  const overBalance = available !== null && requested > available;
  const belowMinimum = minimum !== null && requested > 0 && requested < minimum;
  const canQuote = requested > 0 && !overBalance && phase === 'idle';

  /**
   * Price the route as the user types, without reserving anything.
   *
   * `dry: true` throughout: a committed quote reserves a deposit address and starts its 72-hour clock, which
   * has no business happening while someone is still deciding on an amount.
   */
  useEffect(() => {
    let live = true;
    /**
     * Clearing happens inside the timer, not synchronously in the effect body.
     *
     * A synchronous setState here cascades a second render on every keystroke — the exact pattern that made
     * inputs elsewhere in this app feel like they caught. The debounce already gives us a natural place to do it.
     */
    const timer = setTimeout(async () => {
      if (requested <= 0 || overBalance) {
        if (live) setPreview(null);
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
        /**
         * "Amount is too low" carries the exact minimum, so turn it into a number the UI can use rather than
         * repeating the raw sentence. Any other rejection — no liquidity for this size, service down — is the
         * service's own words and is shown as-is.
         */
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
  }, [requested, overBalance, solanaAddress, suiAddress]);

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

  const handleMove = async () => {
    setError(null);
    setPhase('quoting');
    try {
      const [sol, sui] = await Promise.all([findAsset('sol', 'SOL'), findAsset('sui', 'SUI')]);
      if (!sol || !sui) throw new Error('The intents service does not currently list SOL → SUI.');

      // Commit: this reserves the deposit address the transfer will pay.
      const committed = await quote({
        originAsset: sol.assetId,
        destinationAsset: sui.assetId,
        amount: String(Math.floor(requested * 10 ** sol.decimals)),
        refundTo: solanaAddress,
        recipient: suiAddress,
        slippageBps: SLIPPAGE_BPS,
        dry: false,
      });
      if (!committed.depositAddress) {
        throw new Error('The intents service did not return a deposit address.');
      }
      setPreview(committed);

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
        recipient: committed.depositAddress,
        // The exact committed amount — an underpayment is refunded rather than filled.
        amount: String(Number(committed.amountInFormatted ?? amount)),
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
      notifyDeposit(hash, committed.depositAddress);

      setPhase('watching');
      setStatus('PENDING_DEPOSIT');
      setStatusLine('Deposit sent. Solvers are filling it…');
      await watch(committed.depositAddress);
    } catch (e) {
      console.error(e);
      setError(friendlyError(e));
      setPhase('idle');
      setStatusLine('');
    }
  };

  const reset = () => {
    setPhase('idle');
    setPreview(null);
    setStatus(null);
    setStatusLine('');
    setDepositTx(null);
    setAmount('');
    setError(null);
  };

  const busy = phase === 'quoting' || phase === 'signing' || phase === 'watching';

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ArrowDownToLine className="w-4 h-4 text-[var(--muted)]" aria-hidden />
          <h2 className="font-bold text-sm">Move SOL into this wallet</h2>
        </div>
        <span className="mono-label">via NEAR Intents</span>
      </div>

      {phase === 'done' ? (
        <div className="space-y-3">
          {status === 'SUCCESS' && (
            <p className="text-sm text-[var(--success)]">
              SUI has landed in this wallet.
            </p>
          )}
          {status === 'REFUNDED' && (
            <p className="text-sm text-[var(--warning)]">
              The swap did not fill, so your SOL was refunded to the account it came from.
            </p>
          )}
          {status === 'FAILED' && (
            <ErrorNote
              message="The swap failed."
              action="Your SOL is refunded automatically to the sending account. Nothing further is needed."
              raw="status: FAILED"
            />
          )}
          {depositTx && <CopyField label="Deposit transaction" value={depositTx} href={txUrl('Solana', depositTx)} />}
          <Button variant="secondary" size="sm" onClick={reset} className="w-full">
            Move more
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] text-[var(--muted)] leading-relaxed">
            Sends SOL from your Solana dWallet and credits native SUI here — no wrapped assets. Settlement is
            usually well under a minute. If no solver fills it, your SOL is refunded automatically to the
            account it came from.
          </p>

          <div>
            <div className="flex items-baseline justify-between mb-1">
              <label htmlFor="intent-amount" className="mono-label">
                Amount to move
              </label>
              {available !== null && available > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(String(Number((available * 0.98).toFixed(6))))}
                  disabled={busy}
                  title="Leaves a little SOL behind for the transfer fee"
                  className="mono-label hover:text-[var(--foreground)] transition disabled:opacity-40"
                >
                  Max
                </button>
              )}
            </div>
            <div className="relative">
              <input
                id="intent-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                inputMode="decimal"
                autoComplete="off"
                disabled={busy}
                className={`w-full pl-3 pr-14 py-2.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] border text-sm outline-none transition num disabled:opacity-50 ${
                  overBalance || belowMinimum
                    ? 'border-[var(--danger-border)]'
                    : 'border-[var(--border)] focus:border-[var(--border-strong)]'
                }`}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 mono-label pointer-events-none">
                SOL
              </span>
            </div>
            <div className="mono-label mt-1">
              {available === null ? <Skeleton className="h-2.5 w-24" /> : `available ${available} SOL`}
            </div>
            {overBalance && (
              <p className="mt-1 text-xs text-[var(--danger)]">More than this account holds.</p>
            )}
            {belowMinimum && (
              <p className="mt-1 text-xs text-[var(--danger)]">
                Below the service minimum of {minimum} SOL.
              </p>
            )}
          </div>

          {preview && !busy && (
            <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-3 space-y-1">
              <div className="flex items-baseline justify-between">
                <span className="mono-label">You receive</span>
                <span className="text-sm font-semibold num">
                  ≈ {preview.amountOutFormatted} <span className="text-[var(--muted)] font-normal">SUI</span>
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="mono-label">Guaranteed minimum</span>
                <span className="text-xs num text-[var(--muted)]">
                  {(Number(preview.minAmountOut) / 1e9).toFixed(6)} SUI
                </span>
              </div>
              {preview.timeEstimate && (
                <div className="flex items-baseline justify-between">
                  <span className="mono-label">Estimated time</span>
                  <span className="text-xs num text-[var(--muted)]">~{preview.timeEstimate}s</span>
                </div>
              )}
            </div>
          )}

          {statusLine && <StatusNote>{statusLine}</StatusNote>}
          {error && <ErrorNote {...error} />}

          {depositTx && phase === 'watching' && (
            <a
              href={txUrl('Solana', depositTx)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[11px] text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              <ExternalLink className="w-3 h-3" aria-hidden /> View the deposit on Solana
            </a>
          )}

          <Button
            onClick={handleMove}
            disabled={!canQuote || belowMinimum || !preview}
            loading={busy}
            className="w-full"
          >
            {phase === 'quoting'
              ? 'Getting a deposit address…'
              : phase === 'signing'
                ? 'Signing…'
                : phase === 'watching'
                  ? 'Waiting for SUI…'
                  : 'Move to Sui'}
          </Button>
        </div>
      )}
    </div>
  );
}
