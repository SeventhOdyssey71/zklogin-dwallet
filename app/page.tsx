'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSuiClient } from '@mysten/dapp-kit';
import { toast } from 'sonner';
import { Check, Loader2, Copy } from 'lucide-react';
import { ConnectWallet } from '@/components/ConnectWallet';
import { SendModal } from '@/components/SendModal';
import { GasBalances } from '@/components/GasBalances';
import { useZkLogin } from '@/lib/useZkLogin';
import { zkLoginSignAndExecute } from '@/lib/zklogin/execute';
import { createDWallet, CreateStep, CreatedDWallet, DWalletKind } from '@/lib/ika/createDWallet';
import { listDWallets, OwnedDWallet } from '@/lib/ika/listDWallets';

/** Minimal account shape used across views (zkLogin user → Sui address). */
type ZkAccount = { address: string } | null;

const CHAIN_SYMBOLS: Record<string, string> = {
  Bitcoin: 'BTC',
  Ethereum: 'ETH',
  Polygon: 'MATIC',
  Avalanche: 'AVAX',
  BSC: 'BNB',
  Solana: 'SOL',
  Polkadot: 'DOT',
  Cardano: 'ADA',
  NEAR: 'NEAR',
};

const fmtUsd = (v: number) =>
  v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STEPS: { key: CreateStep; label: string }[] = [
  { key: 'init', label: 'Connect to Ika network' },
  { key: 'prepare', label: 'Prepare key generation' },
  { key: 'request', label: 'Request dWallet (sign #1)' },
  { key: 'awaiting-network', label: 'Network MPC key shares' },
  { key: 'accept', label: 'Accept share (sign #2)' },
  { key: 'activating', label: 'Confirm activation' },
  { key: 'done', label: 'Active' },
];

const KINDS: { kind: DWalletKind; title: string; curve: string; chains: string }[] = [
  { kind: 'ECDSA', title: 'ECDSA', curve: 'secp256k1', chains: 'Ethereum · Bitcoin · Polygon · BSC · Avalanche' },
  { kind: 'EdDSA', title: 'EdDSA', curve: 'ed25519', chains: 'Solana · Polkadot · Cardano · NEAR' },
];

type Tab = 'create' | 'wallets' | 'all';

const CHAIN_ORDER = [
  'Bitcoin',
  'Ethereum',
  'Polygon',
  'Avalanche',
  'BSC',
  'Solana',
  'Polkadot',
  'Cardano',
  'NEAR',
];

export default function Home() {
  const { user } = useZkLogin();
  const account: ZkAccount = user ? { address: user.address } : null;
  const [tab, setTab] = useState<Tab>('create');

  return (
    <main className="relative z-10 min-h-screen flex flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6 py-4 max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-4">
          <span className="font-extrabold tracking-tight text-lg">dWallet</span>
          {account && (
            <nav className="flex items-center gap-1 text-sm">
              <TabButton active={tab === 'create'} onClick={() => setTab('create')}>
                Create
              </TabButton>
              <TabButton active={tab === 'wallets'} onClick={() => setTab('wallets')}>
                My wallets
              </TabButton>
              <TabButton active={tab === 'all'} onClick={() => setTab('all')}>
                All chains
              </TabButton>
            </nav>
          )}
        </div>
        <ConnectWallet />
      </header>

      {account && <GasBalances address={account.address} />}

      <section
        className={`flex-1 flex justify-center px-5 sm:px-6 py-10 ${
          tab === 'create' ? 'items-center' : 'items-start'
        }`}
      >
        <div className="w-full max-w-2xl">
          {tab === 'create' && (
            <CreateView account={account} onCreated={() => setTab('wallets')} />
          )}
          {tab === 'wallets' && (
            <WalletsView account={account} onCreate={() => setTab('create')} />
          )}
          {tab === 'all' && <AllChainsView account={account} onCreate={() => setTab('create')} />}
        </div>
      </section>

      <footer className="text-center py-5 mono-label">Ika dWallets on Sui · built for linq</footer>
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-[8px] whitespace-nowrap transition ${
        active
          ? 'bg-[var(--surface-2)] text-[var(--foreground)] border border-[var(--border)]'
          : 'text-[var(--muted)] hover:text-[var(--foreground)]'
      }`}
    >
      {children}
    </button>
  );
}

/* ----------------------------- Create ----------------------------- */

function CreateView({
  account,
  onCreated,
}: {
  account: ZkAccount;
  onCreated: () => void;
}) {
  const suiClient = useSuiClient();

  const [kind, setKind] = useState<DWalletKind>('ECDSA');
  const [creating, setCreating] = useState(false);
  const [activeStep, setActiveStep] = useState<CreateStep | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [result, setResult] = useState<CreatedDWallet | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Enforce: a zkLogin user may create at most ONE ECDSA and ONE EdDSA dWallet.
  const [existing, setExisting] = useState<Set<DWalletKind>>(new Set());
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!account) return;
      setChecking(true);
      try {
        const wallets = await listDWallets(suiClient, account.address);
        const kinds = new Set<DWalletKind>(wallets.map((w) => w.curve as DWalletKind));
        if (!cancelled) setExisting(kinds);
      } catch {
        /* allow creation if the check fails */
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account?.address, suiClient, result]);

  const alreadyHasKind = existing.has(kind);
  const hasBoth = existing.has('ECDSA') && existing.has('EdDSA');

  const stepIndex = activeStep ? STEPS.findIndex((s) => s.key === activeStep) : -1;

  const handleCreate = async () => {
    if (!account || alreadyHasKind) return;
    setCreating(true);
    setError(null);
    setResult(null);
    try {
      const created = await createDWallet({
        suiClient,
        account,
        signAndExecuteAsync: (params) => zkLoginSignAndExecute(suiClient, account.address, params),
        kind,
        onStatus: (step, message) => {
          setActiveStep(step);
          setStatusMsg(message);
        },
      });
      setResult(created);
      toast.success('dWallet is active', { description: created.address || created.dwalletId });
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'Failed to create dWallet');
      toast.error('Creation failed', { description: e?.message?.slice(0, 80) });
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div className="mb-8 text-center">
        <div className="mono-label mb-3">Ika 2PC-MPC · Sui testnet</div>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">
          Create a multi-chain
          <br />
          dWallet in two signatures
        </h1>
        <p className="text-[var(--muted)] text-sm mt-3 max-w-md mx-auto">
          One key, split across the network — no single party ever holds it. Sign in with Google to
          begin (one ECDSA + one EdDSA per account).
        </p>
      </div>

      <AnimatePresence mode="wait">
        {!account && (
          <motion.div
            key="connect"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="card p-8 flex flex-col items-center gap-5 text-center"
          >
            <p className="text-sm text-[var(--muted)]">
              Sign in with Google — your Sui address is derived via zkLogin (no wallet, no seed
              phrase). Fund that address with testnet{' '}
              <b className="text-[var(--foreground)]">SUI</b> (gas) and{' '}
              <b className="text-[var(--foreground)]">IKA</b> to create dWallets.
            </p>
            <ConnectWallet />
            <a
              href="https://faucet.ika.xyz/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs underline"
            >
              Get IKA testnet tokens →
            </a>
          </motion.div>
        )}

        {account && !creating && !result && (
          <motion.div
            key="picker"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-4"
          >
            <div className="grid sm:grid-cols-2 gap-3">
              {KINDS.map((k) => {
                const selected = kind === k.kind;
                const owned = existing.has(k.kind);
                return (
                  <button
                    key={k.kind}
                    onClick={() => setKind(k.kind)}
                    className={`card p-5 text-left transition relative ${
                      selected
                        ? 'border-[var(--foreground)] ring-1 ring-[var(--foreground)]/30'
                        : 'hover:bg-[var(--surface-2)]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-bold">{k.title}</div>
                      {owned ? (
                        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-[var(--foreground)]">
                          Created
                        </span>
                      ) : (
                        selected && <Check className="w-4 h-4" />
                      )}
                    </div>
                    <div className="mono-label mb-3">{k.curve}</div>
                    <div className="text-xs text-[var(--muted)] leading-relaxed">{k.chains}</div>
                  </button>
                );
              })}
            </div>

            {error && (
              <div className="card p-3 border-[var(--border)]">
                <p className="text-xs text-[var(--foreground)] break-words">{error}</p>
              </div>
            )}

            {hasBoth ? (
              <div className="card p-4 text-center space-y-3">
                <p className="text-sm">
                  You&apos;ve created both your <b>ECDSA</b> and <b>EdDSA</b> dWallets — that&apos;s the
                  limit (one of each).
                </p>
                <button
                  onClick={onCreated}
                  className="px-4 py-2.5 rounded-[10px] bg-[var(--foreground)] text-black font-semibold text-sm hover:brightness-90 transition"
                >
                  View all chains
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={handleCreate}
                  disabled={checking || alreadyHasKind}
                  className="w-full py-3.5 rounded-[12px] bg-[var(--foreground)] text-black font-bold hover:brightness-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {alreadyHasKind ? `${kind} already created` : `Create ${kind} dWallet`}
                </button>
                <p className="text-center text-[11px] text-[var(--muted)]">
                  {alreadyHasKind
                    ? 'Each account is limited to one ECDSA and one EdDSA dWallet. Pick the other curve.'
                    : "You'll approve two transactions. Takes ~30–60s while the network runs MPC."}
                </p>
              </>
            )}
          </motion.div>
        )}

        {creating && (
          <motion.div
            key="progress"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="card p-6"
          >
            <div className="mono-label mb-4">{statusMsg || 'Working…'}</div>
            <ol className="space-y-3">
              {STEPS.slice(0, -1).map((s, i) => {
                const done = i < stepIndex;
                const current = i === stepIndex;
                return (
                  <li key={s.key} className="flex items-center gap-3">
                    <span
                      className={`w-6 h-6 rounded-full grid place-items-center text-[11px] shrink-0 border ${
                        done
                          ? 'bg-[var(--foreground)] text-black border-[var(--foreground)]'
                          : current
                            ? 'border-[var(--foreground)] text-[var(--foreground)]'
                            : 'border-[var(--border)] text-[var(--muted)]'
                      }`}
                    >
                      {done ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : current ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        i + 1
                      )}
                    </span>
                    <span
                      className={`text-sm ${
                        current
                          ? 'text-[var(--foreground)]'
                          : done
                            ? 'text-[var(--muted)]'
                            : 'text-[var(--muted)]/60'
                      }`}
                    >
                      {s.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </motion.div>
        )}

        {result && (
          <motion.div
            key="result"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="card p-6"
          >
            <div className="mb-5">
              <div className="font-bold">dWallet is active</div>
              <div className="mono-label">{result.curve} · secured by 2PC-MPC</div>
            </div>

            <Field label="dWallet ID" value={result.dwalletId} />
            {result.address && <Field label="Address" value={result.address} />}
            {result.publicKey && <Field label="Public key" value={result.publicKey} />}

            <div className="grid grid-cols-2 gap-3 mt-5">
              <button
                onClick={() => {
                  setResult(null);
                  setActiveStep(null);
                  setStatusMsg('');
                }}
                className="py-3 rounded-[12px] border border-[var(--border)] hover:bg-[var(--surface-2)] transition font-semibold text-sm"
              >
                Create another
              </button>
              <button
                onClick={onCreated}
                className="py-3 rounded-[12px] bg-[var(--foreground)] text-black hover:brightness-90 transition font-semibold text-sm"
              >
                View my wallets
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* --------------------------- My wallets --------------------------- */

function WalletsView({
  account,
  onCreate,
}: {
  account: ZkAccount;
  onCreate: () => void;
}) {
  const suiClient = useSuiClient();
  const [wallets, setWallets] = useState<OwnedDWallet[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<OwnedDWallet | null>(null);

  const load = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    setError(null);
    try {
      const list = await listDWallets(suiClient, account.address);
      setWallets(list);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'Failed to load wallets');
    } finally {
      setLoading(false);
    }
  }, [account, suiClient]);

  useEffect(() => {
    load();
  }, [load]);

  if (selected) {
    return <WalletDetail wallet={selected} account={account} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">My wallets</h1>
          <div className="mono-label mt-1">dWallets owned by this address</div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-2 rounded-[10px] border border-[var(--border)] text-sm hover:bg-[var(--surface-2)] transition disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {loading && !wallets && (
        <div className="card p-8 flex items-center justify-center gap-3 text-sm text-[var(--muted)]">
          <Loader2 className="w-4 h-4 animate-spin" /> Reading dWallets from Sui…
        </div>
      )}

      {error && (
        <div className="card p-3 border-[var(--border)]">
          <p className="text-xs break-words">{error}</p>
        </div>
      )}

      {wallets && wallets.length === 0 && !loading && (
        <div className="card p-8 text-center space-y-4">
          <p className="text-sm text-[var(--muted)]">No dWallets yet for this address.</p>
          <button
            onClick={onCreate}
            className="px-4 py-2.5 rounded-[10px] bg-[var(--foreground)] text-black font-semibold text-sm hover:brightness-90 transition"
          >
            Create your first dWallet
          </button>
        </div>
      )}

      {wallets && wallets.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3">
          {wallets.map((w, i) => (
            <button
              key={w.id}
              onClick={() => setSelected(w)}
              className={`card p-4 w-full flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-[var(--surface-2)] hover:border-[var(--foreground)]/40 transition ${
                i === 0 ? 'border-[var(--foreground)]/60' : ''
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-bold text-sm">{w.curve}</span>
                  <StateBadge state={w.state} />
                  {i === 0 && (
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--foreground)] text-black">
                      Newest
                    </span>
                  )}
                </div>
                <code className="text-xs text-[var(--muted)] break-all">{w.id}</code>
                {w.createdAtEpoch > 0 && (
                  <div className="mono-label mt-1">created · epoch {w.createdAtEpoch}</div>
                )}
              </div>
              <span className="text-[var(--muted)] text-lg shrink-0">›</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const active = state === 'Active';
  return (
    <span
      className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${
        active
          ? 'border-[var(--foreground)] text-[var(--foreground)]'
          : 'border-[var(--border)] text-[var(--muted)]'
      }`}
    >
      {active ? 'Active' : 'Pending'}
    </span>
  );
}

/* --------------------------- All chains --------------------------- */

function AllChainsView({
  account,
  onCreate,
}: {
  account: ZkAccount;
  onCreate: () => void;
}) {
  const suiClient = useSuiClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ChainRow[]>([]);
  const [sources, setSources] = useState<{ ecdsa?: string; eddsa?: string }>({});

  const load = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    setError(null);
    try {
      const [{ getDWalletAddresses }, { fetchAllBalances }, { fetchTokenMarkets }] =
        await Promise.all([
          import('@/lib/ika/walletDetail'),
          import('@/lib/utils/fetchBalances'),
          import('@/lib/utils/prices'),
        ]);

      // Newest Active wallet of each curve (listDWallets is already newest-first).
      const wallets = await listDWallets(suiClient, account.address);
      const ecdsa = wallets.find((w) => w.curve === 'ECDSA' && w.state === 'Active');
      const eddsa = wallets.find((w) => w.curve === 'EdDSA' && w.state === 'Active');
      setSources({ ecdsa: ecdsa?.id, eddsa: eddsa?.id });

      const markets = await fetchTokenMarkets();
      const addrMap: Record<string, string> = {};
      const srcMap: Record<string, { id: string; capId: string }> = {};
      // (chain, addresses, curveNumber) per wallet, for the balance pass below.
      const balanceJobs: { addresses: Record<string, string>; curveNumber: number }[] = [];

      for (const w of [ecdsa, eddsa]) {
        if (!w) continue;
        const { addresses, curveNumber } = await getDWalletAddresses(suiClient, w.id);
        Object.assign(addrMap, addresses);
        for (const chain of Object.keys(addresses)) srcMap[chain] = { id: w.id, capId: w.capId };
        balanceJobs.push({ addresses, curveNumber });
      }

      // Phase 1: show rows immediately (addresses + logos), balances pending.
      const baseRows: ChainRow[] = CHAIN_ORDER.filter((c) => addrMap[c]).map((chain) => {
        const src = srcMap[chain] || { id: '', capId: '' };
        return {
          chain,
          symbol: CHAIN_SYMBOLS[chain] || chain,
          address: addrMap[chain],
          balance: '…',
          usd: 0,
          logo: markets[chain]?.logo ?? '',
          dwalletId: src.id,
          dwalletCapId: src.capId,
        };
      });
      setRows(baseRows);
      setLoading(false);

      // Phase 2: fetch balances per wallet and merge in as they resolve.
      const balMap: Record<string, { balance: string; usdValue: number }> = {};
      for (const job of balanceJobs) {
        Object.assign(balMap, await fetchAllBalances(job.addresses, job.curveNumber));
      }
      setRows((prev) =>
        prev.map((r) => {
          const b = balMap[r.chain] || { balance: '0', usdValue: 0 };
          return { ...r, balance: b.balance, usd: b.usdValue };
        })
      );
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'Failed to load chains');
      setLoading(false);
    }
  }, [account, suiClient]);

  useEffect(() => {
    load();
  }, [load]);

  const total = rows.reduce((s, r) => s + r.usd, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">All chains</h1>
          <div className="mono-label mt-1">across your ECDSA + EdDSA dWallets</div>
        </div>
        <div className="text-right">
          <div className="mono-label">Total</div>
          <div className="text-xl font-extrabold">${fmtUsd(total)}</div>
        </div>
      </div>

      {loading && (
        <div className="card p-8 flex items-center justify-center gap-3 text-sm text-[var(--muted)]">
          <Loader2 className="w-4 h-4 animate-spin" /> Gathering addresses, balances &amp; prices…
        </div>
      )}

      {error && (
        <div className="card p-3 border-[var(--border)]">
          <p className="text-xs break-words">{error}</p>
        </div>
      )}

      {!loading && (
        <>
          {/* Missing-curve hints */}
          {!sources.ecdsa && (
            <MissingCurveNote label="No active ECDSA wallet — create one to add Bitcoin + EVM chains." onCreate={onCreate} />
          )}
          {!sources.eddsa && (
            <MissingCurveNote label="No active EdDSA wallet — create one to add Solana, Polkadot, Cardano & NEAR." onCreate={onCreate} />
          )}

          {rows.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-3">
              {rows.map((r) => (
                <ChainRowCard key={r.chain} row={r} zkAddress={account?.address ?? ''} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MissingCurveNote({ label, onCreate }: { label: string; onCreate: () => void }) {
  return (
    <div className="card p-3 flex items-center justify-between gap-3">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <button
        onClick={onCreate}
        className="shrink-0 px-3 py-1.5 rounded-[8px] bg-[var(--foreground)] text-black font-semibold text-xs hover:brightness-90 transition"
      >
        Create
      </button>
    </div>
  );
}

/* --------------------------- Wallet detail --------------------------- */

interface ChainRow {
  chain: string;
  symbol: string;
  address: string;
  balance: string;
  usd: number;
  logo: string;
  /** Which dWallet this chain belongs to (for sending). */
  dwalletId: string;
  dwalletCapId: string;
}

function WalletDetail({
  wallet,
  account,
  onBack,
}: {
  wallet: OwnedDWallet;
  account: ZkAccount;
  onBack: () => void;
}) {
  const suiClient = useSuiClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ChainRow[]>([]);
  const [active, setActive] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Lazy-load the heavy crypto/RPC modules on the client only (keeps them out of SSR/prerender).
        const [{ getDWalletAddresses }, { fetchAllBalances }, { fetchTokenMarkets }] =
          await Promise.all([
            import('@/lib/ika/walletDetail'),
            import('@/lib/utils/fetchBalances'),
            import('@/lib/utils/prices'),
          ]);
        const { addresses, curveNumber, active: isActive } = await getDWalletAddresses(
          suiClient,
          wallet.id
        );
        if (!isActive) {
          if (!cancelled) {
            setActive(false);
            setLoading(false);
          }
          return;
        }
        // Phase 1: show rows immediately (addresses + logos + prices) — fast.
        const markets = await fetchTokenMarkets();
        const baseRows: ChainRow[] = Object.entries(addresses).map(([chain, address]) => ({
          chain,
          symbol: CHAIN_SYMBOLS[chain] || chain,
          address,
          balance: '…',
          usd: 0,
          logo: markets[chain]?.logo ?? '',
          dwalletId: wallet.id,
          dwalletCapId: wallet.capId,
        }));
        if (cancelled) return;
        setRows(baseRows);
        setLoading(false);

        // Phase 2: fill balances as they resolve (slow chains no longer block the view).
        const balances = await fetchAllBalances(addresses, curveNumber);
        if (cancelled) return;
        setRows((prev) =>
          prev.map((r) => {
            const b = balances[r.chain] || { balance: '0', usdValue: 0 };
            return { ...r, balance: b.balance, usd: b.usdValue };
          })
        );
      } catch (e: any) {
        console.error(e);
        if (!cancelled) {
          setError(e?.message || 'Failed to load wallet');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet.id, suiClient]);

  const total = rows.reduce((s, r) => s + r.usd, 0);

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition"
      >
        ‹ Back to wallets
      </button>

      <div className="card p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold">{wallet.curve}</span>
              <StateBadge state={wallet.state} />
            </div>
            <code className="text-xs text-[var(--muted)] break-all">{wallet.id}</code>
          </div>
          <div className="text-right shrink-0">
            <div className="mono-label">Total</div>
            <div className="text-xl font-extrabold">${fmtUsd(total)}</div>
          </div>
        </div>

        {loading && (
          <div className="py-8 flex items-center justify-center gap-3 text-sm text-[var(--muted)]">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading addresses, balances &amp; prices…
          </div>
        )}

        {!loading && !active && (
          <p className="py-6 text-center text-sm text-[var(--muted)]">
            This dWallet isn&apos;t active yet, so addresses can&apos;t be derived. Finish activation first.
          </p>
        )}

        {error && <p className="py-4 text-center text-sm break-words">{error}</p>}

        {!loading && active && (
          <div className="space-y-2">
            {rows.map((r) => (
              <ChainRowCard key={r.chain} row={r} zkAddress={account?.address ?? ''} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChainRowCard({ row, zkAddress }: { row: ChainRow; zkAddress: string }) {
  const [sendOpen, setSendOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-[12px] border border-[var(--border)] p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {row.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.logo} alt="" className="w-8 h-8 rounded-full grayscale" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-[var(--surface-2)] grid place-items-center text-[10px]">
              {row.symbol.slice(0, 3)}
            </div>
          )}
          <div className="min-w-0">
            <div className="font-semibold text-sm">{row.chain}</div>
            <div className="mono-label">{row.symbol}</div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-semibold tabular-nums">
            {row.balance} {row.symbol}
          </div>
          <div className="mono-label">${fmtUsd(row.usd)}</div>
        </div>
      </div>

      {/* Receive (copy address) + Send */}
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => {
            navigator.clipboard.writeText(row.address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 rounded-[8px] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--foreground)]/40 transition group"
          title="Copy address to receive"
        >
          <span className="mono-label shrink-0">Receive</span>
          <code className="text-xs break-all text-left flex-1 text-[var(--foreground)]/90">
            {row.address}
          </code>
          {copied ? (
            <Check className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <Copy className="w-3.5 h-3.5 text-[var(--muted)] shrink-0 group-hover:text-[var(--foreground)]" />
          )}
        </button>
        <button
          onClick={() => setSendOpen(true)}
          disabled={!zkAddress}
          className="shrink-0 px-4 py-2 rounded-[8px] bg-[var(--foreground)] text-black font-semibold text-xs hover:brightness-90 transition disabled:opacity-40"
        >
          Send
        </button>
      </div>

      <SendModal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        chain={row.chain}
        symbol={row.symbol}
        fromAddress={row.address}
        balance={row.balance}
        dwalletId={row.dwalletId}
        dwalletCapId={row.dwalletCapId}
        zkAddress={zkAddress}
      />
    </div>
  );
}

/* ------------------------------ bits ------------------------------ */

function Field({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mb-3">
      <div className="mono-label mb-1">{label}</div>
      <button
        onClick={() => {
          navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-[10px] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--foreground)]/50 transition group"
      >
        <code className="text-xs break-all text-left flex-1 text-[var(--foreground)]/90">{value}</code>
        {copied ? (
          <Check className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <Copy className="w-3.5 h-3.5 text-[var(--muted)] shrink-0 group-hover:text-[var(--foreground)]" />
        )}
      </button>
    </div>
  );
}
