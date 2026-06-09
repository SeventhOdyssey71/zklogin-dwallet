'use client';

/**
 * Top strip showing the signed-in zkLogin Sui address's testnet SUI + IKA balances —
 * the funds that pay for dWallet creation (SUI gas) and MPC fees (IKA).
 */

import { useEffect, useState, useCallback } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import { Loader2 } from 'lucide-react';

const IKA_PACKAGE_ID =
  process.env.NEXT_PUBLIC_IKA_PACKAGE_ID ||
  '0x1f26bb2f711ff82dcda4d02c77d5123089cb7f8418751474b9fb744ce031526a';
const IKA_COIN_TYPE = `${IKA_PACKAGE_ID}::ika::IKA`;

const SUI_LOGO = 'https://cryptologos.cc/logos/sui-sui-logo.png';
const IKA_LOGO = 'https://coin-images.coingecko.com/coins/images/67598/large/ika.jpg?1753770879';

// Testnet faucets — fund the signed-in zkLogin address with SUI (gas) and IKA (MPC fees).
const SUI_FAUCET = 'https://faucet.sui.io/?network=testnet';
const IKA_FAUCET = 'https://faucet.ika.xyz/';

function fmt(raw: string, decimals: number): string {
  const n = Number(raw) / 10 ** decimals;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function GasBalances({ address }: { address: string }) {
  const suiClient = useSuiClient();
  const [sui, setSui] = useState<string | null>(null);
  const [ika, setIka] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [suiBal, ikaBal, ikaMeta] = await Promise.all([
        suiClient.getBalance({ owner: address }),
        suiClient
          .getBalance({ owner: address, coinType: IKA_COIN_TYPE })
          .catch(() => ({ totalBalance: '0' })),
        suiClient.getCoinMetadata({ coinType: IKA_COIN_TYPE }).catch(() => null),
      ]);
      setSui(fmt(suiBal.totalBalance, 9));
      setIka(fmt(ikaBal.totalBalance, ikaMeta?.decimals ?? 9));
    } catch (e) {
      console.error('Failed to load gas balances:', e);
    } finally {
      setLoading(false);
    }
  }, [suiClient, address]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 px-5 sm:px-6 pb-3 max-w-5xl mx-auto w-full">
      <div className="flex items-center gap-2">
        <TokenPill logo={SUI_LOGO} symbol="SUI" amount={sui} loading={loading} faucet={SUI_FAUCET} />
        <TokenPill logo={IKA_LOGO} symbol="IKA" amount={ika} loading={loading} faucet={IKA_FAUCET} />
        <button
          onClick={load}
          disabled={loading}
          className="ml-1 mono-label hover:text-[var(--foreground)] transition disabled:opacity-50"
          title="Refresh balances"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '↻'}
        </button>
      </div>
      <div className="mono-label flex items-center gap-2">
        <span>testnet faucet:</span>
        <a href={SUI_FAUCET} target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--foreground)]">
          SUI ↗
        </a>
        <a href={IKA_FAUCET} target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--foreground)]">
          IKA ↗
        </a>
      </div>
    </div>
  );
}

function TokenPill({
  logo,
  symbol,
  amount,
  loading,
  faucet,
}: {
  logo: string;
  symbol: string;
  amount: string | null;
  loading: boolean;
  faucet: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo} alt={symbol} className="w-4 h-4 rounded-full object-contain" />
      <span className="text-sm tabular-nums">
        {amount ?? (loading ? '…' : '0')} <span className="text-[var(--muted)]">{symbol}</span>
      </span>
      <a
        href={faucet}
        target="_blank"
        rel="noopener noreferrer"
        title={`Get testnet ${symbol}`}
        className="text-[var(--muted)] hover:text-[var(--foreground)] text-xs"
      >
        ＋
      </a>
    </div>
  );
}
