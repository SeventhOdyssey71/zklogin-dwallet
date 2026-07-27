'use client';

/**
 * The signed-in address's SUI and IKA balances.
 *
 * Extracted from the navbar because onboarding needs the same two numbers: SUI pays Sui gas and IKA pays
 * 2PC-MPC session fees, so "can this account do anything yet" is the same question in both places. Two
 * copies of this would inevitably disagree about formatting or decimals.
 *
 * Deliberately NOT part of the multi-chain balance store: those are dWallet balances on other chains,
 * whereas these belong to the zkLogin account itself and are read straight from Sui.
 *
 * A REFRESH REACHES EVERY COPY
 * ---------------------------
 * The navbar and the shell each call this, so each held its own state and its own refresh — which meant
 * a swap that credited SUI could refresh the balance on the page while the navbar went on showing the
 * old one until something else happened to reload it. The two numbers are the same fact about the same
 * account, so a refresh is broadcast to every mounted instance rather than kept private to one.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import { IKA_COIN_TYPE } from '@/lib/config/network';
import { warn } from '@/lib/utils/log';

/** Every mounted instance's tick setter, so one refresh moves them all. */
const listeners = new Set<() => void>();

/**
 * Refetch SUI and IKA everywhere they are shown.
 *
 * Exported so code with no hook of its own — the swap flow settling, a completed send — can say "these
 * numbers just changed" without needing a reference to a particular component's refresh.
 */
export function refreshGasBalances(): void {
  for (const bump of listeners) bump();
}

function fmt(raw: string, decimals: number): string {
  const n = Number(raw) / 10 ** decimals;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** SUI + IKA balances of the signed-in address. `null` means "not loaded yet", never "zero". */
export function useGasBalances(address: string | undefined) {
  const suiClient = useSuiClient();
  const [sui, setSui] = useState<string | null>(null);
  const [ika, setIka] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  /**
   * Subscribe this instance to broadcast refreshes.
   *
   * Registered in an effect rather than at render time so a discarded render never leaves a listener
   * behind, and removed on unmount so a stale setter cannot be called after the component is gone.
   */
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    void (async () => {
      try {
        const [s, i, meta] = await Promise.all([
          suiClient.getBalance({ owner: address }),
          suiClient
            .getBalance({ owner: address, coinType: IKA_COIN_TYPE })
            .catch(() => ({ totalBalance: '0' })),
          suiClient.getCoinMetadata({ coinType: IKA_COIN_TYPE }).catch(() => null),
        ]);
        if (cancelled) return;
        setSui(fmt(s.totalBalance, 9));
        setIka(fmt(i.totalBalance, meta?.decimals ?? 9));
      } catch (e) {
        // A swallowed read, not a fault: the values already on screen stay, and the next `tick`
        // retries. A flaky connection would otherwise print this on a loop in a production console.
        warn('Failed to load gas balances:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [suiClient, address, tick]);

  /** Stable, and broadcast: refreshing here refreshes the navbar's copy too. */
  const refresh = useCallback(() => refreshGasBalances(), []);

  return { sui, ika, loading, refresh };
}

