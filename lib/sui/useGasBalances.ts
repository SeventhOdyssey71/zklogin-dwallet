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
 */

import { useEffect, useState } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import { IKA_COIN_TYPE } from '@/lib/config/network';

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
        console.error('Failed to load gas balances:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [suiClient, address, tick]);

  return { sui, ika, loading, refresh: () => setTick((t) => t + 1) };
}

