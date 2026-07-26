'use client';

import { useState, useEffect, useCallback, useMemo, useSyncExternalStore } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { NavBar, type NavTab } from '@/components/NavBar';
import { useZkLogin, consumeExpiredNotice } from '@/lib/useZkLogin';
import { zkLoginSignAndExecute } from '@/lib/zklogin/execute';
// Types are erased at build time, so importing them costs nothing. `createBothDWallets` is loaded on
// demand in `handleCreate` — it pulls ethers and the Ika SDK, and nobody needs either until they
// actually press Create.
import type { CreateStep, CreatedDWallet } from '@/lib/ika/createDWallet';
import { ALL_KINDS, type DWalletKind } from '@/lib/ika/curves';
import { listDWallets } from '@/lib/ika/listDWallets';
import { CHAINS } from '@/lib/config/chainRegistry';
import { SuiWalletView } from '@/components/SuiWalletView';
import { HistoryView } from '@/components/HistoryView';
import { LandingPage } from '@/components/landing/LandingPage';
import { Onboarding, type OnboardStage } from '@/components/onboarding/Onboarding';
import { DashboardOverview } from '@/components/dashboard/DashboardOverview';
import type { DashboardActivity, DashboardChain } from '@/components/dashboard/shared';
import { useGasBalances } from '@/lib/sui/useGasBalances';
import { IKA_ACQUIRE_URL } from '@/lib/config/network';
import { readHistory, subscribe as subscribeHistory } from '@/lib/history/store';
import { Button, ErrorNote, truncate } from '@/components/ui';
import { useBalances, REFRESH_SECONDS, type BalanceTarget } from '@/lib/balances/useBalances';
import { friendlyError, type FriendlyError } from '@/lib/ui/errors';
import { txUrl } from '@/lib/config/chainRegistry';

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
  const { user, loading, signIn } = useZkLogin();
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

  // Signed-out users get the landing page; a hash for a signed-in view would otherwise render an empty shell.
  const view = account ? tab : 'create';
  const signedOut = !loading && !account;

  return (
    <main className="relative z-10 min-h-screen flex flex-col">
      <NavBar tab={view} setTab={setTab} address={account?.address} />

      {/* Content is centred in whatever space the navbar and footer leave, so a short page like
          Create sits in the middle of the viewport rather than hugging the top. */}
      {/* Create is a single column of prose and one card, so it stays narrow and centred; the
          data-dense views take the full container width. */}
      <section
        className={`flex-1 flex justify-center px-4 sm:px-6 py-8 ${
          view === 'create' && !signedOut ? 'items-center' : 'items-start'
        }`}
      >
        <div className={`w-full mx-auto ${view === 'create' && !signedOut ? 'max-w-3xl' : 'max-w-7xl'}`}>
          {loading ? (
            <div className="card p-10 flex items-center justify-center gap-3 text-sm text-[var(--muted)]">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Restoring your session…
            </div>
          ) : signedOut ? (
            <LandingPage onSignIn={() => void signIn()} />
          ) : (
            <>
              {view === 'create' && (
                <CreateView account={account} onCreated={() => setTab('all')} />
              )}
              {view === 'all' && (
                <AllChainsView
                  account={account}
                  onCreate={() => setTab('create')}
                  onViewHistory={() => setTab('history')}
                />
              )}
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

  /**
   * Whether the account can actually pay for setup.
   *
   * Creating all three dWallets was measured at ~0.1996 SUI plus ~0.06 IKA for the DKG transaction, and the
   * accept transaction follows it. These floors leave room for that plus fee movement, so the button is only
   * enabled when the transaction will really go through — offering it otherwise just spends the user's time
   * on a guaranteed failure.
   */
  const { sui, ika, loading: gasLoading, refresh: refreshGas } = useGasBalances(account?.address);
  const SUI_FLOOR = 0.25;
  const IKA_FLOOR = 0.1;
  const funded =
    sui !== null &&
    ika !== null &&
    (parseFloat(sui.replace(/,/g, '')) || 0) >= SUI_FLOOR &&
    (parseFloat(ika.replace(/,/g, '')) || 0) >= IKA_FLOOR;

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

  /**
   * Where the user is in setup.
   *
   * Derived rather than stored: a second source of truth for "which step am I on" is how a stepper ends up
   * disagreeing with the thing it is describing.
   */
  const stage: OnboardStage = result ? 'done' : creating ? 'working' : funded ? 'create' : 'fund';

  return (
    <Onboarding
      address={account?.address ?? ''}
      suiBalance={sui}
      ikaBalance={ika}
      funded={funded}
      stage={stage}
      activeStepIndex={stepIndex}
      statusMessage={statusMsg}
      steps={STEPS.slice(0, -1).map((s) => s.label)}
      error={error}
      acquireIkaUrl={IKA_ACQUIRE_URL}
      onCreate={handleCreate}
      onRefreshBalances={refreshGas}
      onFinish={onCreated}
      refreshing={gasLoading || checking}
    />
  );
}

/* --------------------------- All chains --------------------------- */

function AllChainsView({
  account,
  onCreate,
  onViewHistory,
}: {
  account: ZkAccount;
  onCreate: () => void;
  onViewHistory: () => void;
}) {
  const suiClient = useSuiClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [rows, setRows] = useState<ChainRow[]>([]);
  const [targets, setTargets] = useState<BalanceTarget[]>([]);

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
        /**
         * Refetch the chain, but do not flag it as "live".
         *
         * These events are block-scoped on EVM: `newHeads` fires on every block regardless of whether
         * this address was involved, so treating one as a deposit lit up chains holding nothing. The
         * refetch is still right — it is how a real deposit is noticed — but the visual claim was false.
         */
        onActivity: (chain) => refreshSoon(chain),
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

  /**
   * The send dialog now lives here rather than inside each card.
   *
   * One dialog for fourteen chains instead of fourteen dialogs: the card only reports which chain was
   * chosen, so a card re-render cannot reach into an open dialog someone is typing in.
   */
  const [sendChain, setSendChain] = useState<string | null>(null);
  const sendRow = sendChain ? rows.find((r) => r.chain === sendChain) : undefined;

  const onSend = useCallback((chain: string) => setSendChain(chain), []);

  const onReceive = useCallback(
    (chain: string) => {
      const row = rows.find((r) => r.chain === chain);
      if (!row) return;
      navigator.clipboard.writeText(row.address).then(
        () => toast.success(`${chain} address copied`, { description: truncate(row.address, 14, 10) }),
        () => toast.error('Could not copy', { description: 'Clipboard access was denied.' })
      );
    },
    [rows]
  );

  /**
   * Recent activity, read from the shared ledger.
   *
   * `useSyncExternalStore` rather than local state, so a send recorded from inside the dialog appears here
   * without the two views needing to know about each other.
   */
  const historyVersion = useSyncExternalStore(
    subscribeHistory,
    () => String(readHistory(account?.address ?? '').length),
    () => '0'
  );
  const recentActivity: DashboardActivity[] = useMemo(
    () =>
      readHistory(account?.address ?? '')
        .slice(0, 6)
        .map((e) => ({
          id: e.id,
          kind: e.kind,
          chain: e.chain,
          symbol: e.symbol,
          amount: e.amount,
          at: e.at,
          txHash: e.txHash,
          explorerUrl: e.txHash ? txUrl(e.chain, e.txHash) : undefined,
          detected: e.detected,
        })),
    // `historyVersion` changes whenever the ledger does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [account?.address, historyVersion]
  );

  /**
   * The chains, shaped for the dashboard and ordered richest first.
   *
   * Balances live in the shared store, so `balance`/`usdValue` stay undefined until a chain has actually
   * been read — the dashboard renders a skeleton for those rather than a zero, because a wallet showing 0
   * when it means "unknown" reads as "your funds are gone".
   */
  const dashboardChains: DashboardChain[] = useMemo(
    () =>
      ordered.map((r) => {
        const b = balances[r.chain];
        return {
          chain: r.chain,
          symbol: r.symbol,
          logo: r.logo,
          balance: b?.at ? b.balance : undefined,
          usdValue: b?.at ? b.usdValue : undefined,
          stale: Boolean(b?.error),
        };
      }),
    [ordered, balances]
  );

  const dashboard = (
    <DashboardOverview
      totalUsd={total}
      loading={loading || priced.length === 0}
      busy={busy}
      updatedAt={updatedAt}
      refreshSeconds={REFRESH_SECONDS}
      chains={dashboardChains}
      recentActivity={recentActivity}
      onRefresh={() => void refresh()}
      onSend={onSend}
      onReceive={onReceive}
      onViewAllHistory={onViewHistory}
    />
  );

  return (
    <>
      {/* A failure to discover dWallets or derive addresses must be visible: without this the dashboard
          renders an empty state that looks like "you have no wallets" rather than "this did not load". */}
      {error && (
        <div className="mb-4">
          <ErrorNote {...error} />
        </div>
      )}

      {/* No chains and nothing loading means the account has no active dWallets yet. */}
      {!loading && !error && rows.length === 0 && (
        <div className="card p-8 text-center space-y-3 mb-4">
          <p className="text-sm text-[var(--muted)]">
            No active dWallets on this account yet.
          </p>
          <Button onClick={onCreate}>Set up my wallets</Button>
        </div>
      )}

      {dashboard}
      {sendRow && (
        <SendModal
          open
          onClose={() => setSendChain(null)}
          chain={sendRow.chain}
          symbol={sendRow.symbol}
          fromAddress={sendRow.address}
          balance={balances[sendRow.chain]?.balance ?? '0'}
          dwalletId={sendRow.dwalletId}
          dwalletCapId={sendRow.dwalletCapId}
          zkAddress={account?.address ?? ''}
          onSent={() => {
            void import('@/lib/balances/store').then((m) => m.refreshSoon(sendRow.chain));
          }}
        />
      )}
    </>
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


