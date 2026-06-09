'use client';

/**
 * Send a transaction from a dWallet on a target chain.
 *
 * The dWallet 2PC-MPC pipeline (`signWithDWallet`) builds the target-chain tx, runs presign + sign
 * as two Sui transactions, and broadcasts. Those two Sui transactions are signed via zkLogin
 * (`zkLoginSignAndExecute`) instead of a browser wallet — same identity that created the dWallet.
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useSuiClient } from '@mysten/dapp-kit';
import { toast } from 'sonner';
import { signWithDWallet, broadcastTransaction } from '@/lib/dwallet/clientSideSigning';
import { zkLoginSignAndExecute } from '@/lib/zklogin/execute';

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

export function SendModal({
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
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const reset = () => {
    setRecipient('');
    setAmount('');
    setError(null);
    setStatus('');
    setTxHash(null);
  };

  const handleSend = async () => {
    setError(null);
    if (!recipient.trim()) return setError('Enter a recipient address');
    if (!amount || parseFloat(amount) <= 0) return setError('Enter a valid amount');
    if (parseFloat(amount) > parseFloat(balance || '0')) return setError('Insufficient balance');

    setLoading(true);
    setStatus('Signing with dWallet (2PC-MPC) — approve in zkLogin. ~30–60s while the network runs MPC…');
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
        signAndExecuteTransaction: (params: any) => zkLoginSignAndExecute(suiClient, zkAddress, params),
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
      toast.success(`Sent ${amount} ${symbol}`, { description: finalHash?.slice(0, 24) + '…' });
      onSent?.();
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'Send failed');
    } finally {
      setLoading(false);
      setStatus('');
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={loading ? undefined : onClose}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40"
          />
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-md z-50 card p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">
                Send {symbol} <span className="text-[var(--muted)] font-normal">on {chain}</span>
              </h3>
              {!loading && (
                <button
                  onClick={onClose}
                  className="text-[var(--muted)] hover:text-[var(--foreground)] text-lg leading-none"
                >
                  ✕
                </button>
              )}
            </div>

            {txHash ? (
              <div className="space-y-4">
                <p className="text-sm">Sent ✓</p>
                <code className="block text-xs break-all bg-[var(--surface-2)] border border-[var(--border)] rounded-[8px] p-3">
                  {txHash}
                </code>
                <button
                  onClick={() => {
                    reset();
                    onClose();
                  }}
                  className="w-full py-2.5 rounded-[10px] bg-[var(--foreground)] text-black font-semibold text-sm"
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="mono-label mb-1">From ({symbol})</div>
                  <code className="block text-xs break-all text-[var(--muted)]">{fromAddress}</code>
                  <div className="mono-label mt-1">Balance: {balance} {symbol}</div>
                </div>

                <div>
                  <div className="mono-label mb-1">Recipient</div>
                  <input
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder={`${chain} address`}
                    disabled={loading}
                    className="w-full px-3 py-2.5 rounded-[10px] bg-[var(--surface-2)] border border-[var(--border)] text-sm outline-none focus:border-[var(--foreground)]/50 disabled:opacity-50"
                  />
                </div>

                <div>
                  <div className="mono-label mb-1">Amount</div>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.0"
                    inputMode="decimal"
                    disabled={loading}
                    className="w-full px-3 py-2.5 rounded-[10px] bg-[var(--surface-2)] border border-[var(--border)] text-sm outline-none focus:border-[var(--foreground)]/50 disabled:opacity-50"
                  />
                </div>

                {status && (
                  <div className="flex items-start gap-2 text-xs text-[var(--muted)]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin mt-0.5 shrink-0" />
                    {status}
                  </div>
                )}
                {error && <p className="text-xs break-words">{error}</p>}

                <button
                  onClick={handleSend}
                  disabled={loading}
                  className="w-full py-3 rounded-[12px] bg-[var(--foreground)] text-black font-bold text-sm hover:brightness-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Sending…
                    </>
                  ) : (
                    `Send ${symbol}`
                  )}
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
