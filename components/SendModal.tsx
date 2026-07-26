'use client';

/**
 * Send a transaction from a dWallet on a target chain.
 *
 * The dWallet 2PC-MPC pipeline (`signWithDWallet`) builds the target-chain tx, takes a presignature from
 * the pool, runs the signing round as one Sui transaction, and broadcasts. That Sui transaction is signed
 * via zkLogin (`zkLoginSignAndExecute`) rather than a browser wallet — the same identity that created the
 * dWallet.
 */

import { memo, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowRight } from 'lucide-react';
import { useSuiClient } from '@mysten/dapp-kit';
import { signWithDWallet, broadcastTransaction } from '@/lib/dwallet/clientSideSigning';
import { zkLoginSignAndExecute } from '@/lib/zklogin/execute';
import { warmSendPath } from '@/lib/ika/warmSendPath';
import { validateAddress, type AddressCheck } from '@/lib/utils/validateAddress';
import { friendlyError, type FriendlyError } from '@/lib/ui/errors';
import { recordSend } from '@/lib/history/store';
import { txUrl } from '@/lib/config/chainRegistry';
import { NONCE_RENT_SOL } from '@/lib/ika/enableDurableNonce';
import { Button, CopyField, ErrorNote, Modal, StatusNote } from '@/components/ui';

interface SendModalProps {
  open: boolean;
  onClose: () => void;
  chain: string;
  symbol: string;
  fromAddress: string;
  balance: string;
  dwalletId: string;
  dwalletCapId: string;
  zkAddress: string;
  onSent?: () => void;
}

/**
 * Native-token headroom left behind by "Max", as a fraction of the balance.
 *
 * Every chain here is being sent in its *native* token, which is also what pays the fee — so sending the
 * entire balance always fails. The old UI offered no Max at all, leaving users to guess; guessing too
 * high wastes a full MPC signing round on a transaction that cannot succeed. 2% covers a normal transfer
 * fee on every supported chain with room for base-fee movement between building and inclusion.
 */
const MAX_FEE_HEADROOM = 0.02;

/**
 * Memoised, because the view that renders it re-renders on every balance update — about once a second while
 * the deposit watcher is seeing EVM blocks. Without this, an open dialog was re-rendering under the user's
 * cursor and typing felt like it caught. Requires the caller to pass stable callbacks, which it does.
 */
export const SendModal = memo(function SendModal({
  open,
  onClose,
  chain,
  symbol,
  fromAddress,
  balance,
  dwalletId,
  dwalletCapId,
  zkAddress,
  onSent,
}: SendModalProps) {
  const suiClient = useSuiClient();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<FriendlyError | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [warming, setWarming] = useState(false);
  const [check, setCheck] = useState<AddressCheck>({ valid: false });
  /** null = unknown/not applicable, false = available to enable, true = already on. */
  const [durable, setDurable] = useState<boolean | null>(null);
  const [enabling, setEnabling] = useState(false);
  const warmed = useRef(false);

  const numericBalance = parseFloat(balance);
  const balanceKnown = Number.isFinite(numericBalance);
  const maxSendable = balanceKnown ? numericBalance * (1 - MAX_FEE_HEADROOM) : 0;
  const amountNumber = parseFloat(amount);
  const amountValid = Number.isFinite(amountNumber) && amountNumber > 0;
  const overBalance = balanceKnown && amountValid && amountNumber > numericBalance;
  const canSend = check.valid && amountValid && !overBalance && !loading;

  /**
   * Validate the recipient as it is typed, against the real address encoding for this chain.
   *
   * Debounced so a paste mid-word doesn't flash an error, and guarded by a token so a slow validator
   * (the first call loads a crypto library) can't overwrite the verdict for newer input.
   */
  useEffect(() => {
    if (!recipient.trim()) {
      setCheck({ valid: false });
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      void validateAddress(chain, recipient).then((r) => {
        if (current) setCheck(r);
      });
    }, 220);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [recipient, chain]);

  /**
   * Bank a 2PC-MPC v4 presignature ahead of the send.
   *
   * v4 presignatures are client-independent, so this needs neither the amount nor the recipient — it can
   * run the moment the modal opens. That timing is the whole point: the previous version started on the
   * first amount keystroke and then *awaited* it at send time, so anyone who typed an amount and pressed
   * Send within ~15s simply waited out the presign leg anyway. Starting at open, and only ever handing
   * out presignatures that have actually settled, is what removes it from the critical path.
   *
   * It also reclaims presignatures bought by earlier abandoned attempts before spending anything new —
   * each is 0.0209 SUI + 0.12 IKA already paid for.
   */
  const startWarmup = () => {
    if (warmed.current || loading) return;
    warmed.current = true;
    setWarming(true);
    void (async () => {
      /**
       * Load the address validator's crypto library now.
       *
       * The first call to `validateAddress` dynamically imports ethers, @solana/web3.js or
       * @scure/btc-signer depending on the chain, and that import landed on the user's first keystroke
       * — a visible hitch at the worst moment. Doing it on open means the field validates instantly
       * from the first character. Specific to this dialog, so it stays here.
       */
      void validateAddress(chain, '0x0000000000000000000000000000000000000000').catch(() => {});

      await warmSendPath({ suiClient, zkAddress, dwalletId, chain });
      setWarming(false);
    })();
  };

  /**
   * Does this Solana account already sign transactions that cannot expire?
   *
   * Checked on open so the offer only appears when it is actionable, and never for chains it does not apply
   * to. A failure leaves it null, which renders nothing — a diagnostic control must not become noise.
   */
  useEffect(() => {
    // No synchronous setState here: the not-applicable case is handled by gating the render on `chain`
    // below, so this effect only ever writes asynchronously once the answer is known.
    if (!open || chain !== 'Solana' || !fromAddress) return;
    let live = true;
    void import('@/lib/ika/enableDurableNonce').then(({ durableNonceReady }) =>
      durableNonceReady(fromAddress).then((ready) => {
        if (live) setDurable(ready);
      })
    );
    return () => {
      live = false;
    };
  }, [open, chain, fromAddress]);

  const handleEnableDurable = async () => {
    setEnabling(true);
    setError(null);
    try {
      const { enableDurableNonce } = await import('@/lib/ika/enableDurableNonce');
      const result = await enableDurableNonce({
        suiClient,
        dwalletId,
        dwalletCapId,
        zkAddress,
        solanaAddress: fromAddress,
        signAndExecuteTransaction: (p) => zkLoginSignAndExecute(suiClient, zkAddress, p as never),
        onProgress: setStatus,
      });
      setDurable(true);
      toast.success(
        result.status === 'already' ? 'Already set up' : 'Instant signing enabled',
        { description: 'Solana sends no longer race a blockhash deadline.' }
      );
    } catch (e) {
      console.error(e);
      setError(friendlyError(e));
    } finally {
      setEnabling(false);
      setStatus('');
    }
  };

  // Start priming as soon as the modal opens, so the presignature is settled before Send is pressed.
  useEffect(() => {
    if (open) startWarmup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chain, dwalletId]);

  const reset = () => {
    setRecipient('');
    setAmount('');
    warmed.current = false;
    setError(null);
    setStatus('');
    setTxHash(null);
    setCheck({ valid: false });
  };

  const handleSend = async () => {
    setError(null);

    // Re-validate immediately rather than trusting the debounced state: a fast Enter can land before
    // the last keystroke has been checked.
    const verdict = await validateAddress(chain, recipient);
    setCheck(verdict);
    if (!verdict.valid) {
      setError({
        message: verdict.reason ?? `Enter a valid ${chain} address.`,
        raw: verdict.reason ?? '',
      });
      return;
    }
    if (!amountValid) {
      setError({ message: 'Enter an amount greater than zero.', raw: '' });
      return;
    }
    if (overBalance) {
      setError({
        message: `That is more than the ${balance} ${symbol} this address holds.`,
        action: 'Use Max to send the balance minus a fee reserve.',
        raw: '',
      });
      return;
    }

    setLoading(true);
    setStatus('Signing with your dWallet (2PC-MPC v4)…');
    try {
      const signed = await signWithDWallet({
        dwalletId,
        dwalletCapId,
        encryptedShareId: '', // resolved from the dWallet's on-chain share table if empty
        chain,
        recipient: recipient.trim(),
        amount,
        suiClient,
        userAccount: { address: zkAddress },
        signAndExecuteTransaction: (params: { transaction: unknown }) =>
          zkLoginSignAndExecute(suiClient, zkAddress, params as never),
        onProgress: setStatus,
      });

      let finalHash: string;
      if (signed.serialized) {
        setStatus('Broadcasting…');
        const r = await broadcastTransaction(chain, signed.serialized);
        finalHash = r.txHash;
      } else {
        finalHash = signed.txHash || signed.hash;
      }

      setTxHash(finalHash);
      // Recorded from what we broadcast, so History is exact for sends rather than inferred.
      recordSend({
        address: zkAddress,
        chain,
        symbol,
        amount,
        recipient: recipient.trim(),
        txHash: finalHash,
      });
      toast.success(`Sent ${amount} ${symbol}`, { description: `on ${chain}` });
      onSent?.();
    } catch (e) {
      console.error(e);
      setError(friendlyError(e));
    } finally {
      setLoading(false);
      setStatus('');
    }
  };

  const explorer = txHash ? txUrl(chain, txHash) : '';
  // A rejected address only shows once the user has stopped typing and there is a reason to give.
  const showAddressError = Boolean(recipient.trim() && !check.valid && check.reason);

  return (
    <Modal
      open={open}
      onClose={() => {
        if (txHash) reset();
        onClose();
      }}
      locked={loading}
      title={
        txHash ? (
          'Transaction submitted'
        ) : (
          <>
            Send {symbol} <span className="text-[var(--muted)] font-normal">on {chain}</span>
          </>
        )
      }
      subtitle={txHash ? chain : `Balance ${balance} ${symbol}`}
    >
      {txHash ? (
        <div className="space-y-4">
          <p className="text-xs text-[var(--muted)]">
            The network has accepted this transaction. It is final on submission — confirmation follows on
            its own and does not need this window open.
          </p>
          <CopyField
            label="Transaction"
            value={txHash}
            href={explorer || undefined}
            full
          />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={reset}>
              Send another
            </Button>
            <Button
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3.5">
          <CopyField label={`From · your ${chain} address`} value={fromAddress} />

          <div>
            <label htmlFor="send-recipient" className="mono-label mb-1 block">
              Recipient
            </label>
            <input
              id="send-recipient"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={`${chain} address`}
              autoComplete="off"
              spellCheck={false}
              disabled={loading}
              aria-invalid={showAddressError || undefined}
              aria-describedby={showAddressError ? 'send-recipient-error' : undefined}
              className={`w-full px-3 py-2.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] border text-sm outline-none transition disabled:opacity-50 ${
                showAddressError
                  ? 'border-[var(--danger-border)] focus:border-[var(--danger)]'
                  : check.valid
                    ? 'border-[var(--success-border)]'
                    : 'border-[var(--border)] focus:border-[var(--border-strong)]'
              }`}
            />
            {showAddressError && (
              <p id="send-recipient-error" className="mt-1 text-xs text-[var(--danger)]">
                {check.reason}
              </p>
            )}
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-1">
              <label htmlFor="send-amount" className="mono-label">
                Amount
              </label>
              {balanceKnown && maxSendable > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(String(Number(maxSendable.toFixed(8))))}
                  disabled={loading}
                  title={`Send the balance minus a ${Math.round(MAX_FEE_HEADROOM * 100)}% reserve for network fees`}
                  className="mono-label hover:text-[var(--foreground)] transition disabled:opacity-40"
                >
                  Max
                </button>
              )}
            </div>
            <div className="relative">
              <input
                id="send-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                inputMode="decimal"
                autoComplete="off"
                disabled={loading}
                aria-invalid={overBalance || undefined}
                className={`w-full pl-3 pr-16 py-2.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] border text-sm outline-none transition num disabled:opacity-50 ${
                  overBalance
                    ? 'border-[var(--danger-border)] focus:border-[var(--danger)]'
                    : 'border-[var(--border)] focus:border-[var(--border-strong)]'
                }`}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 mono-label pointer-events-none">
                {symbol}
              </span>
            </div>
            {overBalance && (
              <p className="mt-1 text-xs text-[var(--danger)]">
                More than the {balance} {symbol} available.
              </p>
            )}
          </div>

          {chain === 'Solana' && durable === false && !loading && (
            <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-3 space-y-2">
              <p className="text-xs text-[var(--muted)] leading-relaxed">
                Solana transactions normally expire about a minute after they are built, and signing here
                takes ~13s. A one-time setup removes that deadline entirely — the rent is{' '}
                <b className="text-[var(--foreground)]">refundable</b>.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleEnableDurable}
                loading={enabling}
                className="w-full"
              >
                {enabling ? 'Setting up…' : `Enable instant signing (~${NONCE_RENT_SOL.toFixed(5)} SOL)`}
              </Button>
            </div>
          )}

          {chain === 'Solana' && durable === true && !loading && (
            <p className="mono-label text-center">signatures cannot expire on this account</p>
          )}

          {warming && !status && (
            <StatusNote>Banking a presignature so your send goes out instantly…</StatusNote>
          )}
          {status && <StatusNote>{status}</StatusNote>}
          {error && <ErrorNote {...error} />}

          <Button
            size="lg"
            onClick={handleSend}
            disabled={!canSend}
            loading={loading}
            icon={!loading ? <ArrowRight className="w-4 h-4" aria-hidden /> : undefined}
            className="w-full"
          >
            {loading ? 'Sending…' : `Send ${symbol}`}
          </Button>

          <p className="text-[11px] text-[var(--muted-2)] text-center">
            Signed by the Ika network — no single party holds your key.
          </p>
        </div>
      )}
    </Modal>
  );
});
