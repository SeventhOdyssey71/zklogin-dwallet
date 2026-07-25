'use client';

/**
 * My Sui Wallet — the zkLogin account itself.
 *
 * Every other wallet in this app is a dWallet: an MPC key the Ika network co-signs. This one is the
 * plain Sui account behind the Google login, and it is the wallet that *funds* everything else — SUI
 * pays Sui gas, IKA pays 2PC-MPC session fees. It could previously only be topped up; there was no
 * way to take anything back out, which made it a one-way door.
 *
 * Withdrawals here need no MPC, no presignature and no IKA — just an ordinary Sui transaction signed
 * with the zkLogin ephemeral key, so they are near-instant compared with a dWallet send.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { Button, CopyField, ErrorNote, Skeleton } from '@/components/ui';
import { friendlyError, type FriendlyError } from '@/lib/ui/errors';
import { recordSend } from '@/lib/history/store';
import { zkLoginSignAndExecute } from '@/lib/zklogin/execute';
import { suiTxUrl, suiObjectUrl, IKA_ACQUIRE_URL } from '@/lib/config/network';
import {
  fetchSuiWalletAssets,
  buildSuiSendTransaction,
  checkSuiSend,
  toBaseUnits,
  maxSendable,
  formatUnits,
  SUI_COIN_TYPE,
  type SuiAsset,
} from '@/lib/sui/sendSui';
import type { AppSuiClient } from '@/lib/sui/client';

const SUI_LOGO = 'https://cryptologos.cc/logos/sui-sui-logo.png';
const IKA_LOGO = 'https://coin-images.coingecko.com/coins/images/67598/large/ika.jpg?1753770879';

export function SuiWalletView({ address }: { address: string }) {
  const suiClient = useSuiClient() as AppSuiClient;

  const [assets, setAssets] = useState<SuiAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>(SUI_COIN_TYPE);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [lastDigest, setLastDigest] = useState<string | null>(null);

  /**
   * `showSpinner` is false for the initial mount: `loading` already starts true, and flipping it
   * synchronously from inside an effect triggers a cascading re-render.
   */
  const load = useCallback(
    async (showSpinner = true) => {
      if (showSpinner) setLoading(true);
      try {
        setAssets(await fetchSuiWalletAssets(suiClient, address));
      } catch (e) {
        console.error('Failed to load Sui wallet assets:', e);
      } finally {
        setLoading(false);
      }
    },
    [suiClient, address]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await fetchSuiWalletAssets(suiClient, address).catch((e) => {
        console.error('Failed to load Sui wallet assets:', e);
        return [] as SuiAsset[];
      });
      if (cancelled) return;
      setAssets(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [suiClient, address]);

  const asset = assets.find((a) => a.type === selected);
  const suiAsset = assets.find((a) => a.type === SUI_COIN_TYPE);

  const check =
    asset && suiAsset && (recipient || amount)
      ? checkSuiSend({
          asset,
          amount: amount || '0',
          recipient: recipient || '0x',
          suiBalanceRaw: suiAsset.raw,
        })
      : null;

  const setMax = () => {
    if (!asset) return;
    setAmount(formatUnits(maxSendable(asset), asset.decimals));
  };

  const handleSend = async () => {
    if (!asset || !suiAsset) return;
    const verdict = checkSuiSend({ asset, amount, recipient, suiBalanceRaw: suiAsset.raw });
    if (!verdict.ok) {
      toast.error('Cannot send', { description: verdict.blockers[0] });
      return;
    }

    setSending(true);
    setError(null);
    setLastDigest(null);
    try {
      const tx = buildSuiSendTransaction({
        asset,
        amountBaseUnits: toBaseUnits(amount, asset.decimals),
        recipient,
        sender: address,
      });
      const { digest } = await zkLoginSignAndExecute(suiClient, address, { transaction: tx });
      setLastDigest(digest);
      recordSend({
        address,
        chain: 'Sui',
        symbol: asset.symbol,
        amount,
        recipient,
        txHash: digest,
      });
      toast.success(`Sent ${amount} ${asset.symbol}`, { description: digest.slice(0, 20) + '…' });
      setAmount('');
      setRecipient('');
      // Balances settle a moment after execution.
      await suiClient.waitForTransaction({ digest }).catch(() => {});
      await load();
    } catch (e) {
      console.error(e);
      const friendly = friendlyError(e);
      setError(friendly);
      toast.error('Send failed', { description: friendly.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">My Sui Wallet</h1>
          <div className="mono-label mt-1">zkLogin account · funds every dWallet operation</div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void load()}
          loading={loading}
          className="shrink-0"
          aria-label="Refresh balances"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {/* Address */}
      <div className="card p-4 space-y-2.5">
        <CopyField label="Your Sui address" value={address} href={suiObjectUrl(address)} full />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <p className="text-[11px] text-[var(--muted)]">
            Deposit <b className="text-[var(--foreground)]">SUI</b> (gas) and{' '}
            <b className="text-[var(--foreground)]">IKA</b> (MPC fees) to this address.
          </p>
          <a
            href={IKA_ACQUIRE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] underline text-[var(--muted)] hover:text-[var(--foreground)] whitespace-nowrap"
          >
            Swap SUI → IKA on Cetus ↗
          </a>
        </div>
      </div>

      {/* Balances — also the asset selector for the send form */}
      <div className="grid sm:grid-cols-2 gap-3">
        {assets.map((a) => {
          const active = selected === a.type;
          return (
            <button
              key={a.type}
              onClick={() => setSelected(a.type)}
              aria-pressed={active}
              className={`card p-4 text-left transition ${
                active
                  ? 'border-[var(--foreground)] ring-1 ring-[var(--foreground)]/30'
                  : 'hover:bg-[var(--surface-2)]'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-full bg-white/90 grid place-items-center overflow-hidden shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.symbol === 'SUI' ? SUI_LOGO : IKA_LOGO}
                    alt=""
                    className="w-6 h-6 object-contain"
                  />
                </span>
                <span className="mono-label">{a.symbol}</span>
                {active && <Check className="w-3.5 h-3.5 ml-auto" />}
              </div>
              <div className="text-xl font-extrabold num leading-none">
                {loading ? <Skeleton className="h-5 w-24" /> : a.formatted}
              </div>
              {a.type === SUI_COIN_TYPE && (
                <div className="mono-label mt-2 text-[10px]">pays Sui gas</div>
              )}
              {a.type !== SUI_COIN_TYPE && (
                <div className="mono-label mt-2 text-[10px]">pays MPC session fees</div>
              )}
            </button>
          );
        })}
      </div>

      {/* Withdraw */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="mono-label">Withdraw {asset?.symbol ?? ''}</div>
          <div className="mono-label text-[10px]">
            no MPC · no IKA · signed by zkLogin
          </div>
        </div>

        <div className="space-y-2">
          <label className="mono-label text-[10px]" htmlFor="sui-recipient">
            Recipient Sui address
          </label>
          <input
            id="sui-recipient"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x…"
            spellCheck={false}
            className="w-full px-3 py-2.5 rounded-[10px] bg-[var(--surface-2)] border border-[var(--border)] text-xs font-mono outline-none focus:border-[var(--foreground)] transition"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="mono-label text-[10px]" htmlFor="sui-amount">
              Amount
            </label>
            <button
              onClick={setMax}
              className="mono-label text-[10px] underline hover:text-[var(--foreground)]"
            >
              max{' '}
              {asset ? formatUnits(maxSendable(asset), asset.decimals) : '0'} {asset?.symbol}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="sui-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              inputMode="decimal"
              spellCheck={false}
              className="flex-1 px-3 py-2.5 rounded-[10px] bg-[var(--surface-2)] border border-[var(--border)] text-sm font-mono tabular-nums outline-none focus:border-[var(--foreground)] transition"
            />
            <span className="mono-label shrink-0">{asset?.symbol}</span>
          </div>
        </div>

        {check && !check.ok && (recipient !== '' || amount !== '') && (
          <ul className="space-y-1">
            {check.blockers.map((b) => (
              <li key={b} className="text-[11px] text-[var(--warning)] leading-relaxed">
                {b}
              </li>
            ))}
          </ul>
        )}

        {error && <ErrorNote {...error} />}

        <Button
          size="lg"
          onClick={handleSend}
          disabled={!check?.ok}
          loading={sending}
          className="w-full"
        >
          {sending ? 'Sending…' : `Send ${asset?.symbol ?? ''}`}
        </Button>

        {lastDigest && (
          <a
            href={suiTxUrl(lastDigest)}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-[11px] underline text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            View last transaction on explorer ↗
          </a>
        )}
      </div>

      <p className="text-[11px] text-[var(--muted)] text-center">
        Need IKA to pay MPC fees?{' '}
        <a
          href={IKA_ACQUIRE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-[var(--foreground)]"
        >
          Swap SUI → IKA on Cetus ↗
        </a>
      </p>
    </div>
  );
}
