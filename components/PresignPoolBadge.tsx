'use client';

/**
 * Shows the depth of the Ika network's 2PC-MPC v4 presignature pool.
 *
 * v4 lets the network precompute *client-independent* presignatures — valid for any dWallet and any
 * message — so it banks them continuously in the background instead of sitting idle. A signer buys
 * one from that pool and needs only a single online round (~400ms) rather than waiting out the
 * offline phase. This badge makes that visible: the number is the coordinator's live
 * `presign_sessions` count, i.e. presignatures ready to be claimed right now.
 */

import { useEffect, useState } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import { fetchPresignPoolSize } from '@/lib/ika/globalPresign';
import type { AppSuiClient } from '@/lib/sui/client';

export function PresignPoolBadge() {
  const suiClient = useSuiClient() as AppSuiClient;
  const [size, setSize] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Async read, so state only settles after the RPC resolves; the `cancelled` flag covers the
    // unmount race.
    const read = async () => {
      const n = await fetchPresignPoolSize(suiClient);
      if (!cancelled) setSize(n);
    };

    void read();
    // The network replenishes the pool continuously; refresh slowly to keep it honest without
    // hammering the RPC.
    const timer = setInterval(read, 30_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [suiClient]);

  if (size === null) return null;

  return (
    <div
      className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs"
      title="2PC-MPC v4 client-independent presignatures banked by the Ika network and ready to claim — signing takes a single online round."
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
      </span>
      <span className="text-[var(--muted)]">
        presignature pool{' '}
        <b className="text-[var(--foreground)] tabular-nums">{size.toLocaleString()}</b> ready
      </span>
    </div>
  );
}
