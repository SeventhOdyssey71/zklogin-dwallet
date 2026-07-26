'use client';

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSuiClient } from '@mysten/dapp-kit';
import { toast } from 'sonner';
import { Check, Loader2, RefreshCw } from 'lucide-react';
import dynamic from 'next/dynamic';
import { PresignPoolBadge } from '@/components/PresignPoolBadge';
import { NavBar, type NavTab } from '@/components/NavBar';
import { ConnectWallet } from '@/components/ConnectWallet';
import { useZkLogin, consumeExpiredNotice } from '@/lib/useZkLogin';
import { zkLoginSignAndExecute } from '@/lib/zklogin/execute';
// Types are erased at build time, so importing them costs nothing. `createBothDWallets` is loaded on
// demand in `handleCreate` — it pulls ethers and the Ika SDK, and nobody needs either until they
// actually press Create.
import type { CreateStep, CreatedDWallet } from '@/lib/ika/createDWallet';
import { ALL_KINDS, type DWalletKind } from '@/lib/ika/curves';
import { listDWallets } from '@/lib/ika/listDWallets';
import { IKA_ACQUIRE_URL } from '@/lib/config/network';
import { CHAINS } from '@/lib/config/chainRegistry';
import { AllChainChips, useChainAssets, chainCount } from '@/components/ChainChips';
import { SuiWalletView } from '@/components/SuiWalletView';
import { HistoryView } from '@/components/HistoryView';
import { Button, CopyField, ErrorNote, Skeleton } from '@/components/ui';
import { useBalances, useAgeLabel, REFRESH_SECONDS, type BalanceTarget } from '@/lib/balances/useBalances';
import type { Entry as BalanceEntry } from '@/lib/balances/store';
import { friendlyError, type FriendlyError } from '@/lib/ui/errors';
import { addressUrl } from '@/lib/config/chainRegistry';

/**
 * The send dialog, loaded on demand.
 *
 * `SendModal` pulls in `clientSideSigning`, which statically imports every chain signer — and with them
 * `@polkadot/api` (875 KB on its own), ethers, `@solana/web3.js`, `@scure/btc-signer` and the Ika SDK.
 * None of that is needed to *look* at balances, yet all of it was in the initial page load: 3.6 MB of
 * JavaScript before anyone could see a number.
 *
 * Rendered only while open (not merely mounted with `open={false}`), or the dynamic import would fire
 * immediately for all fourteen rows and defer nothing. `prefetchSendModal` below then loads it during
 * idle time, so it is already in memory by the time anyone clicks Send.
 */
const SendModal = dynamic(() => import('@/components/SendModal').then((m) => m.SendModal), {
  ssr: false,
});

/**
 * Warm the send dialog once the page is idle.
 *
 * Without this, deferring the module would simply move the cost to the moment the user wants to act —
 * the worst possible time. Idle-time prefetch keeps the fast first paint and removes the click delay.
 */
function prefetchSendModal(): void {
  if (typeof window === 'undefined') return;
  const load = () => void import('@/components/SendModal');
  if ('requestIdleCallback' in window) {
    (window as Window & { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => void })
      .requestIdleCallback(load, { timeout: 4_000 });
  } else {
    setTimeout(load, 2_000);
  }
}

/** Minimal account shape used across views (zkLogin user → Sui address). */
type ZkAccount = { address: string } | null;

// Symbols come from the chain registry so a new chain needs one entry, not several.
const CHAIN_SYMBOLS: Record<string, string> = Object.fromEntries(
  CHAINS.map((c) => [c.id, c.symbol])
);

/**
 * Trim trailing zeros from a balance.
 *
 * Fetchers pad to a fixed number of decimals, so every empty chain rendered as "0.000000" and a real
 * balance as "0.023630" — visually almost identical at a glance, which is the opposite of what a
 * balance list is for.
 */
const trimAmount = (v: string): string => {
  if (!v.includes('.')) return v;
  const trimmed = v.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' || trimmed === '-' ? '0' : trimmed;
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

// Display order: majors first, then L2s, then the non-EVM chains. Driven off the registry so a
// chain can never be listed here but missing from the app (or vice versa).
const CHAIN_ORDER = [
  'Bitcoin',
  'Ethereum',
  'Base',
  'Arbitrum',
  'Optimism',
  'Polygon',
  'Avalanche',
  'BSC',
  'Linea',
  'Scroll',
  'Solana',
  'NEAR',
  'Cardano',
  'Polkadot',
];

const TAB_KEYS: NavTab[] = ['create', 'all', 'history', 'sui'];

/**
 * Keep the active tab in the URL hash.
 *
 * Tab state lived only in React, so a refresh — or the redirect back from Google sign-in — always dumped
 * you on Create, even if you were three clicks into All chains. The hash also makes a view linkable and
 * gives the browser Back button something sensible to do.
 */
function useTabFromHash(): [NavTab, (t: NavTab) => void] {
  const [tab, setTab] = useState<NavTab>('create');

  useEffect(() => {
    const read = () => {
      const fromHash = window.location.hash.replace('#', '') as NavTab;
      if (TAB_KEYS.includes(fromHash)) setTab(fromHash);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  const go = useCallback((t: NavTab) => {
    setTab(t);
    // replaceState rather than assigning `hash`: this shouldn't add a history entry per tab click.
    window.history.replaceState(null, '', `#${t}`);
  }, []);

  return [tab, go];
}

export default function Home() {
  const { user, loading } = useZkLogin();
  const account: ZkAccount = user ? { address: user.address } : null;
  const [tab, setTab] = useTabFromHash();

  /**
   * Explain an automatic sign-out.
   *
   * Being returned to the homepage with no warning reads as a bug, so the expiry sets a one-shot flag
   * that this reads (and clears) on arrival. Shown once, not stored — a stale notice on a later visit
   * would be its own confusion.
   */
  useEffect(() => {
    if (consumeExpiredNotice()) {
      toast('Session expired', {
        description: 'Sessions last 48 hours. Sign in again to continue.',
      });
    }
  }, []);

  // Signed-out users only have Create; landing on a hash for a signed-in view would show an empty shell.
  const view = account ? tab : 'create';

  return (
    <main className="relative z-10 min-h-screen flex flex-col">
      <NavBar tab={view} setTab={setTab} address={account?.address} />

      {/* Content is centred in whatever space the navbar and footer leave, so a short page like
          Create sits in the middle of the viewport rather than hugging the top. */}
      {/* Create is a single column of prose and one card, so it stays narrow and centred; the
          data-dense views take the full container width. */}
      <section
        className={`flex-1 flex justify-center px-4 sm:px-6 py-8 ${
          view === 'create' ? 'items-center' : 'items-start'
        }`}
      >
        <div className={`w-full mx-auto ${view === 'create' ? 'max-w-3xl' : 'max-w-7xl'}`}>
          {loading ? (
            <div className="card p-10 flex items-center justify-center gap-3 text-sm text-[var(--muted)]">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Restoring your session…
            </div>
          ) : (
            <>
              {view === 'create' && (
                <CreateView account={account} onCreated={() => setTab('all')} />
              )}
              {view === 'all' && <AllChainsView account={account} onCreate={() => setTab('create')} />}
              {view === 'history' && account && <HistoryView address={account.address} />}
              {view === 'sui' && account && <SuiWalletView address={account.address} />}
            </>
          )}
        </div>
      </section>

      <footer className="text-center py-5 mono-label">built by 71labs</footer>
    </main>
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

  const chainAssets = useChainAssets();
  const [creating, setCreating] = useState(false);
  const [activeStep, setActiveStep] = useState<CreateStep | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [result, setResult] = useState<CreatedDWallet | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);

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

  const hasBoth = ALL_KINDS.every((k) => existing.has(k));

  const stepIndex = activeStep ? STEPS.findIndex((s) => s.key === activeStep) : -1;

  /**
   * Create every curve the account is still missing, batched.
   *
   * Both DKGs ride in one programmable transaction block and both accepts in a second, so the user
   * approves 2 transactions instead of 4 and the two MPC key generations run concurrently on the
   * network rather than back to back. See `createBothDWallets`.
   */
  const handleCreate = async () => {
    if (!account || hasBoth) return;
    setCreating(true);
    setError(null);
    setResult(null);
    try {
      const { createBothDWallets } = await import('@/lib/ika/createDWallet');
      const created = await createBothDWallets({
        suiClient,
        account,
        signAndExecuteAsync: (params) => zkLoginSignAndExecute(suiClient, account.address, params),
        skip: Array.from(existing),
        onStatus: (step, message) => {
          setActiveStep(step);
          setStatusMsg(message);
        },
      });
      setResult(created[0] ?? null);
      toast.success(
        created.length > 1 ? `${created.length} dWallets are active` : 'dWallet is active',
        { description: created.map((c) => c.curve).join(' + ') }
      );
    } catch (e) {
      console.error(e);
      const friendly = friendlyError(e);
      setError(friendly);
      toast.error('Creation failed', { description: friendly.message });
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div className="mb-6 text-center">
        <div className="mono-label mb-2">Ika 2PC-MPC v4 · Sui mainnet</div>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight leading-tight text-balance">
          One wallet. {chainCount()} chains.
        </h1>
        <p className="text-[var(--muted)] text-sm mt-2.5 max-w-lg mx-auto">
          Keys split across the Ika network — no single party ever holds one. Send and receive on
          every chain below.
        </p>
        <PresignPoolBadge />
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-1.5 text-[11px] text-[var(--muted)]">
          <span aria-hidden>⚠</span>
          <span>
            <b className="text-[var(--foreground)]">Mainnet</b> — real assets, irreversible
            transactions.
          </span>
        </div>
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
              Sign in with Google — your Sui mainnet address is derived via zkLogin (no wallet, no
              seed phrase). Fund that address with{' '}
              <b className="text-[var(--foreground)]">SUI</b> (gas) and{' '}
              <b className="text-[var(--foreground)]">IKA</b> (2PC-MPC session fees) to create
              dWallets.
            </p>
            <ConnectWallet />
            <a
              href={IKA_ACQUIRE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs underline"
            >
              Swap SUI → IKA on Cetus →
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
            {/* One wide block: from the outside these are just the chains the wallet covers.
                Which Ika curve signs each one is an implementation detail, not a user-facing choice. */}
            <div className="card p-4 sm:p-5">
              <AllChainChips assets={chainAssets} />
            </div>

            {error && <ErrorNote {...error} />}

            {hasBoth ? (
              <div className="card p-4 text-center space-y-3">
                <p className="text-sm">Your wallet is ready across all {chainCount()} chains.</p>
                <Button onClick={onCreated}>View all chains</Button>
              </div>
            ) : (
              <div className="flex justify-center">
                <Button
                  size="lg"
                  onClick={handleCreate}
                  loading={checking}
                  className="w-full sm:w-auto sm:min-w-[240px]"
                >
                  {checking ? 'Checking your wallets…' : 'Create dWallet'}
                </Button>
              </div>
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

            <div className="space-y-3">
              <CopyField label="dWallet ID" value={result.dwalletId} />
              {result.address && <CopyField label="Address" value={result.address} />}
              {result.publicKey && <CopyField label="Public key" value={result.publicKey} />}
            </div>

            <div className="grid grid-cols-2 gap-3 mt-5">
              <Button
                variant="secondary"
                size="lg"
                onClick={() => {
                  setResult(null);
                  setActiveStep(null);
                  setStatusMsg('');
                }}
              >
                Create another
              </Button>
              <Button size="lg" onClick={onCreated}>
                View all chains
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
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
  const [error, setError] = useState<FriendlyError | null>(null);
  const [rows, setRows] = useState<ChainRow[]>([]);
  const [targets, setTargets] = useState<BalanceTarget[]>([]);
  const [sources, setSources] = useState<{ ecdsa?: string; eddsa?: string; schnorrkel?: string }>({});
  /** Chains whose balance changed from a realtime on-chain event, for the "live" highlight. */
  const [justUpdated, setJustUpdated] = useState<Set<string>>(new Set());

  /**
   * Balances come from the shared store, not from this component.
   *
   * It owns caching, request coalescing, per-host rate limiting and the 30-second poll, so this view
   * simply declares which chains it cares about. The previous version drove its own fetches and its own
   * refresh timer, which is how a single new block could kick off a full 14-chain sweep before the last
   * one had finished.
   */
  const { balances, busy, updatedAt, refresh } = useBalances(targets);

  const load = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    setError(null);
    try {
      const [{ getDWalletAddresses }, { fetchTokenMarkets }] = await Promise.all([
        import('@/lib/ika/walletDetail'),
        import('@/lib/utils/prices'),
      ]);

      // Newest Active wallet of each curve (listDWallets is already newest-first).
      const wallets = await listDWallets(suiClient, account.address);
      const ecdsa = wallets.find((w) => w.curve === 'ECDSA' && w.state === 'Active');
      const eddsa = wallets.find((w) => w.curve === 'EdDSA' && w.state === 'Active');
      const schnorrkel = wallets.find((w) => w.curve === 'Schnorrkel' && w.state === 'Active');
      setSources({ ecdsa: ecdsa?.id, eddsa: eddsa?.id, schnorrkel: schnorrkel?.id });

      const markets = await fetchTokenMarkets();
      const addrMap: Record<string, string> = {};
      const srcMap: Record<string, { id: string; capId: string }> = {};
      const nextTargets: BalanceTarget[] = [];

      // All three curves — omitting Schnorrkel here silently dropped Polkadot's native address.
      for (const w of [ecdsa, eddsa, schnorrkel]) {
        if (!w) continue;
        const { addresses, curveNumber } = await getDWalletAddresses(suiClient, w.id);
        Object.assign(addrMap, addresses);
        for (const [chain, address] of Object.entries(addresses)) {
          srcMap[chain] = { id: w.id, capId: w.capId };
          nextTargets.push({ chain, address, curve: curveNumber });
        }
      }

      setRows(
        CHAIN_ORDER.filter((c) => addrMap[c]).map((chain) => {
          const src = srcMap[chain] || { id: '', capId: '' };
          return {
            chain,
            symbol: CHAIN_SYMBOLS[chain] || chain,
            address: addrMap[chain],
            logo: markets[chain]?.logo ?? '',
            dwalletId: src.id,
            dwalletCapId: src.capId,
          };
        })
      );
      // Detected deposits are filed against the signed-in account.
      const { setHistoryOwner } = await import('@/lib/balances/store');
      setHistoryOwner(account.address);
      // Registering the targets is what starts polling; the store fetches them itself.
      setTargets(nextTargets.filter((t) => CHAIN_ORDER.includes(t.chain)));
      setLoading(false);
      prefetchSendModal();
    } catch (e) {
      console.error(e);
      setError(friendlyError(e));
      setLoading(false);
    }
  }, [account, suiClient]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Realtime deposit detection: Solana account writes, EVM new blocks, Bitcoin address tracking.
   *
   * An event only asks the store to refetch that one chain; the store's rate limiter and coalescing decide
   * what actually reaches the network, so a burst of blocks can no longer turn into a burst of requests.
   */
  const watchKey = targets.map((t) => `${t.chain}:${t.address}`).join('|');
  useEffect(() => {
    if (targets.length === 0) return;
    let cancelled = false;
    let stop: (() => void) | undefined;

    (async () => {
      const [{ watchDeposits }, { refreshSoon }] = await Promise.all([
        import('@/lib/utils/depositWatcher'),
        import('@/lib/balances/store'),
      ]);
      if (cancelled) return;
      stop = watchDeposits({
        targets: targets.map((t) => ({ chain: t.chain, address: t.address })),
        onActivity: (chain) => {
          refreshSoon(chain);
          setJustUpdated((prev) => new Set(prev).add(chain));
          setTimeout(
            () =>
              setJustUpdated((prev) => {
                const next = new Set(prev);
                next.delete(chain);
                return next;
              }),
            4_000
          );
        },
      });
    })();

    return () => {
      cancelled = true;
      stop?.();
    };
    // Re-subscribe only when the set of watched addresses actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey]);

  const total = rows.reduce((sum, r) => sum + (balances[r.chain]?.usdValue ?? 0), 0);
  const priced = rows.filter((r) => balances[r.chain]?.at);

  /**
   * Highest balance first.
   *
   * Ordered by USD value, then by raw amount so a chain holding funds we could not price still outranks
   * an empty one, and finally by the canonical chain order so the empty majority keeps a stable,
   * predictable arrangement instead of shuffling on every refresh.
   */
  const ordered = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = balances[a.chain]?.usdValue ?? 0;
      const bv = balances[b.chain]?.usdValue ?? 0;
      if (bv !== av) return bv - av;
      const aAmount = parseFloat(balances[a.chain]?.balance ?? '0') || 0;
      const bAmount = parseFloat(balances[b.chain]?.balance ?? '0') || 0;
      if (bAmount !== aAmount) return bAmount - aAmount;
      return CHAIN_ORDER.indexOf(a.chain) - CHAIN_ORDER.indexOf(b.chain);
    });
  }, [rows, balances]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight">All chains</h1>
          <div className="mono-label mt-1">
            {loading ? (
              'Finding your addresses…'
            ) : (
              <UpdatedAgo updatedAt={updatedAt} count={rows.length} />
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <div className="mono-label">Total</div>
            <div className="text-xl font-extrabold num">
              {priced.length === 0 && loading ? <Skeleton className="h-5 w-20" /> : `$${fmtUsd(total)}`}
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refresh()}
            loading={busy}
            icon={!busy ? <RefreshCw className="w-3.5 h-3.5" aria-hidden /> : undefined}
            title={`Refresh now — balances also refresh every ${REFRESH_SECONDS}s`}
          >
            Refresh
          </Button>
        </div>
      </div>

      {loading && (
        <div
          aria-busy="true"
          aria-label="Loading your chains"
          className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3"
        >
          {Array.from({ length: 9 }, (_, i) => (
            <ChainCardSkeleton key={i} />
          ))}
        </div>
      )}

      {error && <ErrorNote {...error} />}

      {!loading && (
        <>
          {/* Missing-curve hints */}
          {!sources.ecdsa && (
            <MissingCurveNote label="No active ECDSA wallet — create one to add Bitcoin + EVM chains." onCreate={onCreate} />
          )}
          {!sources.eddsa && (
            <MissingCurveNote label="No active EdDSA wallet — create one to add Solana, Cardano & NEAR." onCreate={onCreate} />
          )}
          {!sources.schnorrkel && (
            <MissingCurveNote label="No active Schnorrkel wallet — create one to add Polkadot." onCreate={onCreate} />
          )}

          {ordered.length > 0 && (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {ordered.map((r) => (
                <ChainRowCard
                  key={r.chain}
                  row={r}
                  balance={balances[r.chain]}
                  zkAddress={account?.address ?? ''}
                  live={justUpdated.has(r.chain)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The shape of a chain card, before its data exists.
 *
 * A centred spinner tells you something is happening but nothing about what is coming, and the layout
 * jumps when the real content replaces it. Mirroring the actual card means the page is laid out
 * correctly from the first frame and only the values fill in.
 */
function ChainCardSkeleton() {
  return (
    <div className="rounded-[12px] border border-[var(--border)] p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Skeleton className="w-8 h-8 rounded-full" />
          <Skeleton className="h-3.5 w-24" />
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-2.5 w-12" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        <Skeleton className="h-9 flex-1 rounded-[var(--radius-xs)]" />
        <Skeleton className="h-9 w-9 rounded-[var(--radius-xs)]" />
        <Skeleton className="h-9 w-16 rounded-[var(--radius-xs)]" />
      </div>
    </div>
  );
}

/**
 * The "updated 12s ago" label, which owns its own ticking.
 *
 * This has to be a leaf component. `useAgeLabel` sets state every second, so calling it inside
 * `AllChainsView` re-rendered that whole subtree — all fourteen chain cards and any open send dialog —
 * once per second, for ever. Typing into a field inside a tree that re-renders at 1Hz is exactly what
 * made the inputs feel like they were catching. Here the state change is confined to this text node.
 */
function UpdatedAgo({ updatedAt, count }: { updatedAt: number; count: number }) {
  const age = useAgeLabel(updatedAt);
  return <>{`${count} chains · updated ${age}`}</>;
}

function MissingCurveNote({ label, onCreate }: { label: string; onCreate: () => void }) {
  return (
    <div className="card p-3 flex items-center justify-between gap-3">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <Button size="sm" onClick={onCreate}>
        Create
      </Button>
    </div>
  );
}

/* --------------------------- Wallet detail --------------------------- */

/**
 * A chain row's static facts.
 *
 * Balances deliberately are NOT here: they live in the shared balance store, so two views showing the same
 * chain read one cached value instead of each fetching their own.
 */
interface ChainRow {
  chain: string;
  symbol: string;
  address: string;
  logo: string;
  /** Which dWallet this chain belongs to (for sending). */
  dwalletId: string;
  dwalletCapId: string;
}

/**
 * One chain row.
 *
 * Memoised because the balance store emits on every read — start and finish, for every chain, on each
 * 30-second poll — and without this all fourteen cards re-rendered each time, including one containing
 * an open send dialog with focus in a text field. Props are compared by identity and the store hands back
 * the same `Entry` object until that chain's value actually changes, so only rows that really moved
 * re-render.
 */
const ChainRowCard = memo(function ChainRowCard({
  row,
  balance,
  zkAddress,
  live = false,
}: {
  row: ChainRow;
  /** From the shared balance store; undefined until first fetched. */
  balance?: BalanceEntry;
  zkAddress: string;
  /** True briefly after a realtime deposit event refreshed this chain's balance. */
  live?: boolean;
}) {
  const [sendOpen, setSendOpen] = useState(false);
  return (
    <div
      className={`rounded-[12px] border p-3.5 transition-colors duration-500 ${
        live
          ? 'border-emerald-500/60 bg-emerald-500/[0.04]'
          : 'border-[var(--border)]'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {row.logo ? (
            <span className="w-8 h-8 rounded-full bg-white grid place-items-center overflow-hidden shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={row.logo} alt="" className="w-[26px] h-[26px] object-contain" />
            </span>
          ) : (
            <div className="w-8 h-8 rounded-full bg-[var(--surface-2)] grid place-items-center text-[10px] shrink-0">
              {row.symbol.slice(0, 3)}
            </div>
          )}
          <div className="min-w-0">
            <div className="font-semibold text-sm flex items-center gap-1.5 truncate">
              {row.chain}
              {live && (
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"
                  title="Balance just updated from a realtime on-chain event"
                />
              )}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          {!balance?.at ? (
            <div className="space-y-1.5 py-0.5">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-2.5 w-12" />
            </div>
          ) : (
            <>
              <div className="text-sm font-semibold num">
                {trimAmount(balance.balance)}{' '}
                <span className="text-[var(--muted)] font-normal">{row.symbol}</span>
              </div>
              <div className="mono-label num flex items-center justify-end gap-1">
                {/* A failed read keeps the last known value rather than showing zero, so it has to say
                    so — a silently stale balance is worse than a visibly stale one. */}
                {balance.error && (
                  <span title={`Could not refresh: ${balance.error}`} className="text-[var(--warning)]">
                    stale
                  </span>
                )}
                ${fmtUsd(balance.usdValue)}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Copy the address to receive, open it on an explorer, or send from it. */}
      <div className="mt-3 flex items-center gap-1.5">
        <div className="flex-1 min-w-0">
          <CopyField value={row.address} href={addressUrl(row.chain, row.address)} />
        </div>
        <Button
          size="md"
          onClick={() => setSendOpen(true)}
          disabled={!zkAddress}
          title={zkAddress ? `Send ${row.symbol}` : 'Sign in to send'}
        >
          Send
        </Button>
      </div>

      {sendOpen && (
        <SendModal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        chain={row.chain}
        symbol={row.symbol}
        fromAddress={row.address}
        balance={balance?.balance ?? '0'}
        dwalletId={row.dwalletId}
        dwalletCapId={row.dwalletCapId}
        zkAddress={zkAddress}
        onSent={() => {
          void import('@/lib/balances/store').then((m) => m.refreshSoon(row.chain));
        }}
        />
      )}
    </div>
  );
});

