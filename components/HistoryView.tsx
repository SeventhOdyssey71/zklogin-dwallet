'use client';

/**
 * History — what this wallet sent, and the deposits it noticed.
 *
 * The two are held to different standards, and the UI says so rather than blurring them: sends are
 * transactions we built and broadcast, so they carry an exact amount, recipient and hash; receives are
 * inferred from a balance going up, so they carry an amount and a time but no counterparty or hash.
 * Presenting a detected deposit as though it were an indexed transaction would be a small lie that
 * becomes a large one the moment someone tries to reconcile it against an explorer.
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ArrowDownLeft, ArrowUpRight, Inbox } from 'lucide-react';
import { readHistory, subscribe, syncFromServer, type HistoryEntry } from '@/lib/history/store';
import { txUrl } from '@/lib/config/chainRegistry';
import { CopyField, truncate } from '@/components/ui';
import { useChainAssets } from '@/components/ChainChips';

const fmtTime = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** "Today" / "Yesterday" / a date, for the day headings. */
function dayLabel(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function HistoryView({ address }: { address: string }) {
  const assets = useChainAssets();

  // Pull anything recorded on another device, and push anything this one holds that the server does not.
  useEffect(() => {
    void syncFromServer(address);
  }, [address]);

  // The ledger is a plain external store, so this stays in step with a send recorded elsewhere without
  // either view having to know about the other.
  const version = useSyncExternalStore(
    subscribe,
    () => String(readHistory(address).length),
    () => '0'
  );

  const groups = useMemo(() => {
    const entries = readHistory(address);
    const byDay = new Map<string, HistoryEntry[]>();
    for (const e of entries) {
      const label = dayLabel(e.at);
      const list = byDay.get(label) ?? [];
      list.push(e);
      byDay.set(label, list);
    }
    return [...byDay.entries()];
    // `version` changes whenever the ledger does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, version]);

  const total = groups.reduce((n, [, list]) => n + list.length, 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">History</h1>
        <div className="mono-label mt-1">
          {total === 0 ? 'nothing recorded yet' : `${total} ${total === 1 ? 'entry' : 'entries'}`}
        </div>
      </div>

      {total === 0 ? (
        <div className="card p-10 flex flex-col items-center gap-3 text-center">
          <Inbox className="w-6 h-6 text-[var(--muted-2)]" aria-hidden />
          <p className="text-sm text-[var(--muted)] max-w-sm">
            Sends appear here as soon as you make them, and deposits appear when this wallet notices your
            balance go up.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(([label, list]) => (
            <section key={label} className="space-y-2">
              <h2 className="mono-label">{label}</h2>
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {list.map((e) => (
                  <HistoryCard key={e.id} entry={e} logo={assets[e.chain]?.logo} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="text-[11px] text-[var(--muted-2)] leading-relaxed">
        This is the wallet&apos;s own record. Sends are exact — they are transactions it built and
        broadcast. Deposits are detected from balance changes while the wallet is open, so one that lands
        while it is closed still shows in your balance but has no dated entry here. Full inbound history
        would need a keyed indexer on each chain.
      </p>
    </div>
  );
}

function HistoryCard({ entry, logo }: { entry: HistoryEntry; logo?: string }) {
  const isSend = entry.kind === 'send';
  const explorer = entry.txHash ? txUrl(entry.chain, entry.txHash) : '';

  return (
    <div className="rounded-[12px] border border-[var(--border)] p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="relative shrink-0">
            {logo ? (
              <span className="w-8 h-8 rounded-full bg-white grid place-items-center overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logo} alt="" className="w-[26px] h-[26px] object-contain" />
              </span>
            ) : (
              <span className="w-8 h-8 rounded-full bg-[var(--surface-2)] grid place-items-center text-[10px]">
                {entry.symbol.slice(0, 3)}
              </span>
            )}
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full grid place-items-center border border-[var(--background)] ${
                isSend ? 'bg-[var(--surface-3)]' : 'bg-[var(--success)]'
              }`}
            >
              {isSend ? (
                <ArrowUpRight className="w-2.5 h-2.5 text-[var(--foreground)]" aria-hidden />
              ) : (
                <ArrowDownLeft className="w-2.5 h-2.5 text-black" aria-hidden />
              )}
            </span>
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">
              {isSend ? 'Sent' : 'Received'}{' '}
              <span className="text-[var(--muted)] font-normal">on {entry.chain}</span>
            </div>
            <div className="mono-label">{fmtTime(entry.at)}</div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-sm font-semibold num ${isSend ? '' : 'text-[var(--success)]'}`}>
            {isSend ? '−' : '+'}
            {entry.amount} <span className="text-[var(--muted)] font-normal">{entry.symbol}</span>
          </div>
          {entry.detected && (
            <div
              className="mono-label"
              title="Noticed from a balance increase — the sender and transaction hash are not known."
            >
              detected
            </div>
          )}
        </div>
      </div>

      {entry.counterparty && (
        <div className="mt-2.5">
          <div className="mono-label mb-1">To</div>
          <code className="text-xs text-[var(--muted)]" title={entry.counterparty}>
            {truncate(entry.counterparty, 12, 10)}
          </code>
        </div>
      )}

      {entry.txHash && (
        <div className="mt-2.5">
          <CopyField value={entry.txHash} href={explorer || undefined} />
        </div>
      )}
    </div>
  );
}
