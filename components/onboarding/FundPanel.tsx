'use client';

/**
 * The funding screen's body: the address to send to, what has arrived, and how to get the missing half.
 *
 * Two tokens with two unrelated jobs is the part of this product that confuses people, and "insufficient
 * balance" after the fact is far more expensive to recover from than a sentence up front — so each balance
 * carries the reason it is needed, right next to the number.
 */

import { Check, ExternalLink, RefreshCw } from 'lucide-react';
import { Button, CopyField, Skeleton } from '@/components/ui';

/** One token: symbol, amount, and the fee it exists to pay. */
function BalanceTile({
  symbol,
  amount,
  pays,
}: {
  symbol: string;
  /** `null` means unknown, not zero — see the Skeleton branch. */
  amount: string | null;
  pays: string;
}) {
  const loading = amount === null;
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
      <div className="mono-label">{symbol}</div>
      <div className="mt-1.5 h-7 flex items-center" aria-busy={loading || undefined}>
        {loading ? (
          <>
            <Skeleton className="h-5 w-24" />
            {/* The skeleton is aria-hidden, so without this the value is simply absent to a screen
                reader — which reads the same as a zero balance. */}
            <span className="sr-only">{symbol} balance loading</span>
          </>
        ) : (
          <span className="text-xl font-extrabold num leading-none">{amount}</span>
        )}
      </div>
      <p className="mt-2 text-[11px] text-[var(--muted)] leading-relaxed">{pays}</p>
    </div>
  );
}

export function FundPanel({
  address,
  suiBalance,
  ikaBalance,
  funded,
  acquireIkaUrl,
  onRefreshBalances,
  refreshing,
}: {
  address: string;
  suiBalance: string | null;
  ikaBalance: string | null;
  funded: boolean;
  acquireIkaUrl: string;
  onRefreshBalances: () => void;
  refreshing: boolean;
}) {
  return (
    <div className="card p-4 sm:p-5 space-y-4">
      <div className="space-y-2">
        <CopyField label="Your Sui address" value={address} full />
        <p className="text-[11px] text-[var(--muted)] leading-relaxed">
          This address comes from your Google account, so it is the same one every time you sign in.
          Send both tokens here.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <BalanceTile
          symbol="SUI"
          amount={suiBalance}
          pays="Pays network fees on Sui, which coordinates every wallet you create and every payment you send."
        />
        <BalanceTile
          symbol="IKA"
          amount={ikaBalance}
          pays="Pays the validators that hold a share of your key and sign alongside you. Only needed when you create a wallet or send."
        />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
        <Button
          variant="secondary"
          size="sm"
          onClick={onRefreshBalances}
          loading={refreshing}
          icon={<RefreshCw className="w-3.5 h-3.5 shrink-0" aria-hidden />}
          className="w-full sm:w-auto"
        >
          {refreshing ? 'Refreshing…' : 'Refresh balances'}
        </Button>
        <a
          href={acquireIkaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] text-[var(--muted)] underline hover:text-[var(--foreground)] transition"
        >
          Swap SUI for IKA
          <ExternalLink className="w-3 h-3 shrink-0" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>

      {funded ? (
        <p className="flex items-start gap-2 text-[11px] text-[var(--muted)]">
          <Check className="w-3.5 h-3.5 mt-px shrink-0 text-[var(--success)]" aria-hidden />
          <span>Both balances are enough to cover setup and your first signatures.</span>
        </p>
      ) : (
        <p className="text-[11px] text-[var(--muted-2)] leading-relaxed">
          Both tokens have to land before you can continue. Sui settles in about a second — if a deposit
          isn&apos;t showing, refresh.
        </p>
      )}
    </div>
  );
}
