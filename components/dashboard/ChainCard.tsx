'use client';

/**
 * One chain, one card: what you hold there and the two things you can do with it.
 *
 * Two constraints shaped this component.
 *
 * First, it is memoised on *primitives*, not on a `DashboardChain` object. The caller re-renders the
 * whole dashboard whenever any single balance resolves, and with fourteen chains that is fourteen
 * cascading re-renders per tick — but the chains array is rebuilt each time, so an object prop would
 * fail every shallow comparison and `memo` would buy nothing. Spreading the fields means thirteen cards
 * bail out by value while the fourteenth updates. The two callbacks take the chain name as an argument
 * for the same reason: a per-card `() => onSend(chain)` closure would be a fresh identity every render.
 *
 * Second, an unloaded balance is never rendered as a number. A wallet that shows "0" when it means "I
 * don't know yet" is telling the user their funds are gone, which is the single worst thing this screen
 * can say. Unknown is a shimmer; zero is a zero.
 */

import { memo, useState } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { Button, Skeleton } from '@/components/ui';
import { formatUsd, trimAmount } from './shared';

/**
 * A chain mark on a light disc.
 *
 * Several official logos are solid black (Scroll, Optimism, Algorand), so on a near-black card they
 * render as nothing at all. The white disc guarantees contrast whatever the CDN serves, and a broken
 * URL falls back to letterforms rather than a browser's torn-image glyph.
 */
function ChainLogo({ logo, symbol }: { logo: string; symbol: string }) {
  const [broken, setBroken] = useState(false);
  const showImage = logo !== '' && !broken;

  return (
    <span className="w-9 h-9 shrink-0 rounded-full bg-white grid place-items-center overflow-hidden">
      {showImage ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={logo}
          alt=""
          width={28}
          height={28}
          loading="lazy"
          onError={() => setBroken(true)}
          className="w-7 h-7 object-contain"
        />
      ) : (
        <span className="text-[10px] font-bold text-black tracking-tight">
          {symbol.slice(0, 3)}
        </span>
      )}
    </span>
  );
}

export interface ChainCardProps {
  chain: string;
  symbol: string;
  logo: string;
  balance?: string;
  usdValue?: number;
  stale?: boolean;
  onSend: (chain: string) => void;
  onReceive: (chain: string) => void;
}

function ChainCardImpl({
  chain,
  symbol,
  logo,
  balance,
  usdValue,
  stale,
  onSend,
  onReceive,
}: ChainCardProps) {
  const pending = balance === undefined;

  return (
    <li
      // `aria-busy` on the card is what tells a screen reader the figure inside is still resolving; the
      // shimmer itself is decorative and hidden from the accessibility tree.
      aria-busy={pending || undefined}
      className={`card p-4 flex flex-col gap-3.5 transition-colors ${
        ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <ChainLogo logo={logo} symbol={symbol} />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight truncate">{chain}</h3>
            <div className="mono-label">{symbol}</div>
          </div>
        </div>

        <div className="shrink-0 flex flex-col items-end gap-1">
          {stale && (
            <span
              title="The last balance read for this chain failed, so the figure shown may be out of date."
              className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.08em] text-[var(--warning)] leading-none"
            >
              <AlertTriangle className="w-3 h-3" aria-hidden />
              stale
            </span>
          )}
        </div>
      </div>

      <div>
        {pending ? (
          <>
            <Skeleton className="h-[18px] w-28" />
            <Skeleton className="h-[11px] w-16 mt-2" />
            <span className="sr-only">Balance loading</span>
          </>
        ) : (
          <>
            <div className="text-[17px] font-bold num leading-none tracking-tight">
              {trimAmount(balance)}{' '}
              <span className="text-[13px] font-medium text-[var(--muted)]">{symbol}</span>
            </div>
            <div className="mt-2 text-xs num text-[var(--muted)] leading-none">
              {usdValue === undefined ? (
                <Skeleton className="h-[11px] w-16" />
              ) : (
                formatUsd(usdValue)
              )}
            </div>
          </>
        )}
      </div>

      {/* `mt-auto` keeps the action row on the baseline across a row of cards whose names wrap
          differently — without it the buttons stagger and the grid stops reading as a grid. */}
      <div className="flex gap-1.5 mt-auto">
        <Button
          variant="secondary"
          size="sm"
          className="flex-1"
          icon={<ArrowUpRight className="w-3.5 h-3.5" aria-hidden />}
          onClick={() => onSend(chain)}
          aria-label={`Send ${symbol} on ${chain}`}
        >
          Send
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="flex-1"
          icon={<ArrowDownLeft className="w-3.5 h-3.5" aria-hidden />}
          onClick={() => onReceive(chain)}
          aria-label={`Copy your ${chain} receive address`}
          title={`Copy your ${chain} receive address`}
        >
          Receive
        </Button>
      </div>
    </li>
  );
}

/**
 * Note there is no local "copied!" state on Receive: the clipboard write happens in the caller, so
 * acknowledging it here would mean claiming success for an operation this component never saw the
 * result of. `navigator.clipboard` genuinely fails (insecure context, denied permission), and a tick
 * shown over a failed copy is how someone ends up pasting the wrong address.
 */
export const ChainCard = memo(ChainCardImpl);
