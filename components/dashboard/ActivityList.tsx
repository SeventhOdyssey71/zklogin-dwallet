'use client';

/**
 * Recent activity — a compact ledger, not a table.
 *
 * Sends and receives are held to different standards and the row says so. A send is a transaction this
 * wallet built and broadcast, so it has an exact amount and a hash you can follow to an explorer. A
 * `detected` receive is inferred from a balance going up while the app was open: real amount, real time,
 * no counterparty and no hash. Rendering the two identically would be a small lie that becomes a large
 * one the moment someone tries to reconcile against a block explorer, so detected rows carry a quiet
 * marker and simply have no link.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDownLeft, ArrowUpRight, ExternalLink, Inbox } from 'lucide-react';
import { relativeTime, trimAmount, useNow, type DashboardActivity } from './shared';

/**
 * A relative timestamp, and deliberately nothing else.
 *
 * This is the only thing in the dashboard subscribed to the ticking clock, and it is a leaf on purpose:
 * when the tick fires it re-renders one `<time>` element per row rather than the list, the grid, or the
 * fourteen chain cards sitting above it.
 *
 * `suppressHydrationWarning` because both the label and the `title` are derived from the reader's clock,
 * locale and timezone — the server's rendering of them is guaranteed to differ and is not worth a
 * console warning over cosmetic text.
 */
function RelativeTime({ at }: { at: number }) {
  const now = useNow();
  const date = new Date(at);
  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString()} suppressHydrationWarning>
      {relativeTime(at, now)}
    </time>
  );
}

export function ActivityList({ items }: { items: DashboardActivity[] }) {
  if (items.length === 0) {
    return (
      <div className="card px-5 py-8 flex flex-col items-center gap-2.5 text-center">
        <Inbox className="w-5 h-5 text-[var(--muted-2)]" aria-hidden />
        <p className="text-xs text-[var(--muted)] max-w-xs leading-relaxed">
          Nothing yet. Sends show up here immediately, and deposits appear as soon as this wallet
          notices a balance go up.
        </p>
      </div>
    );
  }

  return (
    <ul className="card divide-y divide-[var(--border)]">
      <AnimatePresence initial={false}>
        {items.map((item) => {
          const isSend = item.kind === 'send';

          return (
            <motion.li
              key={item.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-3 px-3.5 py-3"
            >
              <span
                className={`shrink-0 w-7 h-7 rounded-full grid place-items-center ${
                  isSend
                    ? 'bg-[var(--surface-2)] text-[var(--foreground)]'
                    : 'bg-[var(--success-surface)] text-[var(--success)]'
                }`}
              >
                {isSend ? (
                  <ArrowUpRight className="w-3.5 h-3.5" aria-hidden />
                ) : (
                  <ArrowDownLeft className="w-3.5 h-3.5" aria-hidden />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold leading-tight truncate">
                  {isSend ? 'Sent' : 'Received'}{' '}
                  <span className="font-normal text-[var(--muted)]">on {item.chain}</span>
                </div>
                <div className="mono-label flex items-center gap-1.5 mt-0.5">
                  <RelativeTime at={item.at} />
                  {item.detected && (
                    <span title="Noticed from a balance increase — the sender and transaction hash are not known.">
                      · detected
                    </span>
                  )}
                </div>
              </div>

              <div
                className={`shrink-0 text-[13px] font-semibold num text-right ${
                  isSend ? '' : 'text-[var(--success)]'
                }`}
              >
                {isSend ? '−' : '+'}
                {trimAmount(item.amount)}{' '}
                <span className="font-normal text-[var(--muted)]">{item.symbol}</span>
              </div>

              {/* A fixed slot either way: letting the link collapse would shift every amount in the
                  list out of alignment depending on whether that row happened to be indexed. */}
              <span className="shrink-0 w-6 grid place-items-center">
                {item.explorerUrl ? (
                  <a
                    href={item.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`View this ${item.chain} transaction on a block explorer`}
                    title="View on block explorer"
                    className="p-1 -m-1 text-[var(--muted-2)] hover:text-[var(--foreground)] transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden />
                  </a>
                ) : null}
              </span>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
