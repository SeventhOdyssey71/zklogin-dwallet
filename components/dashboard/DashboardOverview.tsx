'use client';

/**
 * The dashboard: what you're worth, where it lives, and what just happened.
 *
 * Purely presentational — every number, label and side effect arrives as a prop. That is not
 * architectural neatness for its own sake: balances here come from fourteen different RPCs that resolve
 * at wildly different speeds and fail independently, and keeping that mess entirely in the caller is
 * what lets this file be read as "what does the user see" rather than "what is the network doing".
 *
 * Three decisions worth knowing about:
 *
 *  • Unknown is never drawn as zero. The total is a shimmer until the first balance lands, and each card
 *    shimmers until its own does. A wallet that renders "$0.00" while it is still asking reads as "your
 *    money is gone", and no amount of a spinner elsewhere on the page undoes that first impression.
 *
 *  • Nothing in here owns a clock. The auto-refresh cadence is the caller's; `refreshSeconds` exists
 *    only so the Refresh tooltip can explain that the figures already keep themselves current, which is
 *    what stops people from mashing the button.
 *
 *  • The three sections are ordered by how often they're needed: the total is read at a glance, the
 *    chain grid is where the work happens, and history is a check you do occasionally.
 */

import { RefreshCw, Wallet } from 'lucide-react';
import { Button, Skeleton } from '@/components/ui';
import { ChainCard } from './ChainCard';
import { ActivityList } from './ActivityList';
import { formatUsd, type DashboardActivity, type DashboardChain, useNow, relativeTime } from './shared';

export type { DashboardChain, DashboardActivity } from './shared';

export interface DashboardOverviewProps {
  totalUsd: number;
  /** True until the first balance has loaded. */
  loading: boolean;
  /** True while a refresh is in flight. */
  busy: boolean;
  /** Human label like "12s ago" / "just now" / "never". */
  /**
   * When balances were last read, as epoch ms.
   *
   * A timestamp rather than a pre-rendered label: formatting it in the caller would mean calling
   * `Date.now()` during that component's render (a purity violation here) or running a ticker in a parent
   * that owns the whole chain grid — which is precisely the 1Hz re-render this codebase already had to
   * hunt down once. Rendered by a leaf against the shared clock instead.
   */
  updatedAt: number;
  /** Cadence in seconds that balances auto-refresh, for the tooltip. */
  refreshSeconds: number;
  chains: DashboardChain[];
  /** Most recent activity, newest first. Already trimmed by the caller. */
  recentActivity: DashboardActivity[];
  onRefresh: () => void;
  onSend: (chain: string) => void;
  /** Copy this chain's receive address. */
  onReceive: (chain: string) => void;
  onViewAllHistory: () => void;
}

/**
 * The freshness label, isolated so the shared clock tick re-renders one text node and nothing else.
 */
function UpdatedAgo({ at }: { at: number }) {
  const now = useNow();
  return <>{at ? relativeTime(at, now) : 'never'}</>;
}

export function DashboardOverview({
  totalUsd,
  loading,
  busy,
  updatedAt,
  refreshSeconds,
  chains,
  recentActivity,
  onRefresh,
  onSend,
  onReceive,
  onViewAllHistory,
}: DashboardOverviewProps): React.ReactElement {
  return (
    <div className="space-y-6">
      {/* -------------------------------- total -------------------------------- */}
      <header className="card p-5 sm:p-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="mono-label">Total value</h1>

          {loading ? (
            // A zero total is indistinguishable from an unfinished one at a glance, and only one of
            // those is alarming. Hold the shape of the number until there is a number.
            <div className="mt-2 mb-1.5" aria-busy>
              <Skeleton className="h-9 sm:h-11 w-44 sm:w-56" />
              <span className="sr-only">Loading portfolio value</span>
            </div>
          ) : (
            <div className="mt-1.5 text-[34px] sm:text-[44px] font-extrabold num leading-none tracking-tight break-all">
              {formatUsd(totalUsd)}
            </div>
          )}

          <p className="mono-label mt-2.5">
            updated <UpdatedAgo at={updatedAt} />
          </p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          icon={<RefreshCw className="w-3.5 h-3.5" aria-hidden />}
          onClick={onRefresh}
          // The tooltip's job is to say the figures are already live, so a stale-looking number reads as
          // "a moment old" rather than "broken, click me".
          title={`Balances refresh automatically every ${refreshSeconds}s. Click to refresh now.`}
          aria-label={`Refresh balances now. Refreshes automatically every ${refreshSeconds} seconds.`}
        >
          {busy ? 'Refreshing' : 'Refresh'}
        </Button>
      </header>

      {/* -------------------------------- chains ------------------------------- */}
      <section aria-labelledby="dashboard-chains">
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <h2 id="dashboard-chains" className="mono-label">
            Chains
          </h2>
          {chains.length > 0 && <span className="mono-label num">{chains.length}</span>}
        </div>

        {chains.length === 0 ? (
          <div className="card px-5 py-10 flex flex-col items-center gap-3 text-center">
            <Wallet className="w-6 h-6 text-[var(--muted-2)]" aria-hidden />
            <p className="text-sm text-[var(--muted)] max-w-sm leading-relaxed">
              No chains yet. Once your wallet keys are set up, every chain it covers appears here with
              its own balance and address.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
            {chains.map((c) => (
              // Fields are spread rather than passed as an object: the caller rebuilds this array on
              // every balance tick, so an object prop would defeat `ChainCard`'s memo on all fourteen
              // cards. Primitives compare by value, so only the chain that actually changed re-renders.
              // `onSend`/`onReceive` are forwarded by identity for the same reason — the card supplies
              // its own chain name when calling them, which is why there's no closure here.
              <ChainCard
                key={c.chain}
                chain={c.chain}
                symbol={c.symbol}
                logo={c.logo}
                balance={c.balance}
                usdValue={c.usdValue}
                stale={c.stale}
                live={c.live}
                onSend={onSend}
                onReceive={onReceive}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------- activity ------------------------------ */}
      <section aria-labelledby="dashboard-activity">
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <h2 id="dashboard-activity" className="mono-label">
            Recent activity
          </h2>
          <Button variant="ghost" size="sm" className="-mr-1.5" onClick={onViewAllHistory}>
            View all
          </Button>
        </div>
        <ActivityList items={recentActivity} />
      </section>
    </div>
  );
}
