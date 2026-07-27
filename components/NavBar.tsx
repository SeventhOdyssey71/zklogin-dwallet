'use client';

/**
 * Single-row navigation: brand, tabs, live SUI/IKA balances, account.
 *
 * Previously these were three stacked rows — logo+tabs, then account, then a separate balance strip —
 * because everything competed for one `flex-wrap` container that was too narrow to hold it. Collapsing
 * them into one row means the header stops eating vertical space, which is also what lets the page
 * content sit centred in the viewport instead of being pushed down.
 *
 * Below `lg` the tabs, balances and account move into a hamburger panel rather than wrapping: four
 * tab labels plus two balance pills plus an address cannot fit a phone width, and wrapping them was
 * what pushed the layout past the viewport edge.
 */

import { useState } from 'react';
import { Loader2, Menu, X } from 'lucide-react';
import { ConnectWallet } from '@/components/ConnectWallet';
import { Logo } from '@/components/brand/Logo';
import { useGasBalances } from '@/lib/sui/useGasBalances';

const SUI_LOGO = 'https://cryptologos.cc/logos/sui-sui-logo.png';
const IKA_LOGO = 'https://coin-images.coingecko.com/coins/images/67598/large/ika.jpg?1753770879';

export type NavTab = 'create' | 'all' | 'swap' | 'history' | 'sui';

const TABS: { key: NavTab; label: string }[] = [
  { key: 'create', label: 'Create' },
  // The chain list is now the dashboard: it carries the portfolio total, every chain with send/receive,
  // and recent activity. Keeping the 'all' key means existing #all links still resolve.
  { key: 'all', label: 'Dashboard' },
  { key: 'swap', label: 'Swap' },
  { key: 'history', label: 'History' },
  { key: 'sui', label: 'Sui wallet' },
];

function BalancePill({
  logo,
  symbol,
  amount,
  loading,
}: {
  logo: string;
  symbol: string;
  amount: string | null;
  loading: boolean;
}) {
  return (
    <span
      title={`${amount ?? '0'} ${symbol}`}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] whitespace-nowrap"
    >
      <span className="w-4 h-4 rounded-full bg-white/90 grid place-items-center overflow-hidden shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt="" className="w-4 h-4 object-contain" />
      </span>
      <span className="text-xs num">
        {amount ?? (loading ? '…' : '0')} <span className="text-[var(--muted)]">{symbol}</span>
      </span>
    </span>
  );
}

export function NavBar({
  tab,
  setTab,
  address,
  hasWallets = false,
}: {
  tab: NavTab;
  setTab: (t: NavTab) => void;
  address?: string;
  /** True once this account has created its wallets, which retires the "Create" tab. */
  hasWallets?: boolean;
}) {
  /**
   * Setup is a step, not a destination.
   *
   * Once the wallets exist, "Create" can only lead to a screen that refuses to do anything — the
   * on-chain check allows one dWallet per curve — so leaving it in the navigation offers the user a dead
   * end and pushes the things they actually use further along the row. It stays while the tab is the
   * current view, so navigating there from the dashboard button does not make the row jump.
   */
  const tabs = hasWallets && tab !== 'create' ? TABS.filter((t) => t.key !== 'create') : TABS;

  const [open, setOpen] = useState(false);
  const { sui, ika, loading, refresh } = useGasBalances(address);

  // Close the mobile panel on navigation.
  const go = (t: NavTab) => {
    setTab(t);
    setOpen(false);
  };

  /**
   * `showRefresh` is false in the desktop row between lg and xl: with it, the full row needs ~1030px
   * and overflows a 1024px window by a few pixels. The mobile panel has room, so it keeps the control.
   */
  const balances = (showRefresh: boolean) => (
    <div className="flex items-center gap-1.5">
      <BalancePill logo={SUI_LOGO} symbol="SUI" amount={sui} loading={loading} />
      <BalancePill logo={IKA_LOGO} symbol="IKA" amount={ika} loading={loading} />
      {showRefresh && (
        <button
          onClick={refresh}
          disabled={loading}
          className="mono-label px-1 hover:text-[var(--foreground)] transition disabled:opacity-50"
          title="Refresh balances"
          aria-label="Refresh SUI and IKA balances"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : '↻'}
        </button>
      )}
    </div>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)]/60 bg-[var(--background)]/85 backdrop-blur-md">
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-3 flex items-center gap-4">
        <button
          onClick={() => go(address ? 'all' : 'create')}
          className="shrink-0 hover:opacity-80 transition"
          aria-label="ycos — go to the dashboard"
        >
          <Logo showWordmark className="h-6" />
        </button>

        {/* Desktop: everything on one row. */}
        {address && (
          <nav aria-label="Views" className="hidden lg:flex items-center gap-1 text-sm">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => go(t.key)}
                aria-current={tab === t.key ? 'page' : undefined}
                className={`px-3 py-1.5 rounded-[8px] whitespace-nowrap transition ${
                  tab === t.key
                    ? 'bg-[var(--surface-2)] text-[var(--foreground)] border border-[var(--border)]'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                }`}
              >
                {/* Three tabs fit at every desktop width, so the abbreviated variants that the
                    four-tab row needed between lg and xl are gone. */}
                {t.label}
              </button>
            ))}
          </nav>
        )}

        <div className="flex-1" />

        {address && (
          <>
            <div className="hidden lg:flex xl:hidden">{balances(false)}</div>
            <div className="hidden xl:flex">{balances(true)}</div>
          </>
        )}
        <div className="hidden lg:block shrink-0">
          <ConnectWallet />
        </div>

        {/* Mobile: one hamburger instead of wrapping six controls onto three rows. */}
        {address ? (
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            className="lg:hidden p-2 -mr-1 rounded-[10px] border border-[var(--border)] hover:bg-[var(--surface-2)] transition"
          >
            {open ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        ) : (
          <div className="lg:hidden">
            <ConnectWallet />
          </div>
        )}
      </div>

      {/* Mobile panel */}
      {address && open && (
        <div className="lg:hidden border-t border-[var(--border)]/60 px-4 sm:px-6 py-3 space-y-3">
          <nav aria-label="Views" className="grid grid-cols-2 gap-1.5 text-sm">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => go(t.key)}
                aria-current={tab === t.key ? 'page' : undefined}
                className={`px-3 py-2 rounded-[8px] text-left whitespace-nowrap transition ${
                  tab === t.key
                    ? 'bg-[var(--surface-2)] text-[var(--foreground)] border border-[var(--border)]'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)] border border-transparent'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="flex flex-wrap items-center gap-2">{balances(true)}</div>
          <ConnectWallet />
        </div>
      )}
    </header>
  );
}
