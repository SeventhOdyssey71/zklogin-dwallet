'use client';

/**
 * The landing page, shown to anyone not signed in.
 *
 * Previously a signed-out visitor got the Create screen with its controls disabled — a form they could not
 * use, explaining a concept they had not been introduced to. This separates the two jobs: explain what the
 * wallet is and get them to sign in; then, once signed in, onboard them.
 *
 * Everything above the fold answers one question — what is this and why would I want it — and the single
 * action is Google sign-in, because that is the only action available.
 */

import { ArrowRight, Fingerprint, KeyRound, Layers, ShieldCheck, Zap } from 'lucide-react';
import { ConnectWallet } from '@/components/ConnectWallet';
import { AllChainChips, useChainAssets, chainCount } from '@/components/ChainChips';
import { IKA_ACQUIRE_URL } from '@/lib/config/network';

/** What the wallet does today, in the order a newcomer needs it. */
const PILLARS = [
  {
    icon: Fingerprint,
    title: 'Sign in with Google',
    body: 'zkLogin derives your Sui address from your Google account. No seed phrase to lose, no extension to install.',
  },
  {
    icon: ShieldCheck,
    title: 'No one holds your key',
    body: 'Ika 2PC-MPC splits every key between you and a validator network. Neither half can sign alone — not us, not them.',
  },
  {
    icon: Layers,
    title: `${chainCount()} chains, one account`,
    body: 'Bitcoin, Ethereum and its L2s, Solana, NEAR, Cardano and Polkadot — each with a real address you can send from and receive to.',
  },
  {
    icon: Zap,
    title: 'Signing in seconds',
    body: 'Presignatures are banked before you press Send and your key share is decrypted while you type, so the wait is network time, not ours.',
  },
];

/** Three steps, so the commitment is legible before signing in. */
const STEPS = [
  { n: 1, title: 'Sign in', body: 'Google, via zkLogin. Your Sui address is derived on the spot.' },
  { n: 2, title: 'Fund it', body: 'Add SUI for gas and IKA for signing fees to that address.' },
  { n: 3, title: 'Create your wallets', body: `One step generates the keys behind all ${chainCount()} chains.` },
];

/**
 * What is coming.
 *
 * Stated as intent rather than as features, and deliberately specific about sequencing — Solana first,
 * with Sui as the coordination layer — so it reads as a plan instead of a wish list.
 */
const ROADMAP = [
  {
    title: 'DeFi on Solana',
    body: 'Swaps and liquidity through Solana DEX aggregators, signed by the same dWallet.',
  },
  {
    title: 'Perpetuals',
    body: 'Perps venues on Solana, with positions held by your MPC key rather than an exchange account.',
  },
  {
    title: 'Spot trading',
    body: 'Order routing across Solana venues from inside the wallet.',
  },
  {
    title: 'More chains after Solana',
    body: 'The same integrations extended outward once the Solana path is proven end to end.',
  },
];

export function Landing() {
  const chainAssets = useChainAssets();

  return (
    <div className="w-full max-w-6xl mx-auto space-y-16 sm:space-y-24 py-4">
      {/* ── Hero ── */}
      <section className="text-center space-y-6">
        <div className="mono-label">Ika 2PC-MPC v4 · Sui mainnet</div>
        <h1 className="text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tight leading-[1.05] text-balance max-w-3xl mx-auto">
          One Google login. {chainCount()} chains. No seed phrase.
        </h1>
        <p className="text-[var(--muted)] text-sm sm:text-base max-w-xl mx-auto leading-relaxed">
          A wallet whose keys are split across a validator network, so no single party — including us — can
          ever sign for you. Sui coordinates it all.
        </p>

        <div className="flex flex-col items-center gap-3 pt-2">
          <ConnectWallet />
          <p className="text-[11px] text-[var(--muted-2)]">
            Mainnet · real assets · irreversible transactions
          </p>
        </div>
      </section>

      {/* ── The chains, as the proof of the claim ── */}
      <section className="space-y-3">
        <h2 className="mono-label text-center">Every chain you get</h2>
        <div className="card p-4 sm:p-5">
          <AllChainChips assets={chainAssets} />
        </div>
      </section>

      {/* ── Pillars ── */}
      <section className="grid sm:grid-cols-2 gap-3">
        {PILLARS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="card p-5 space-y-2.5">
            <Icon className="w-5 h-5 text-[var(--foreground)]" aria-hidden />
            <h3 className="font-bold text-sm">{title}</h3>
            <p className="text-xs text-[var(--muted)] leading-relaxed">{body}</p>
          </div>
        ))}
      </section>

      {/* ── How it works ── */}
      <section className="space-y-4">
        <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-center">
          Three steps to a live wallet
        </h2>
        <ol className="grid sm:grid-cols-3 gap-3">
          {STEPS.map((s) => (
            <li key={s.n} className="card p-5 space-y-2">
              <span className="w-7 h-7 rounded-full bg-[var(--foreground)] text-black grid place-items-center text-xs font-extrabold">
                {s.n}
              </span>
              <h3 className="font-bold text-sm">{s.title}</h3>
              <p className="text-xs text-[var(--muted)] leading-relaxed">{s.body}</p>
            </li>
          ))}
        </ol>
        <p className="text-[11px] text-[var(--muted-2)] text-center">
          Step 2 needs IKA —{' '}
          <a
            href={IKA_ACQUIRE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-[var(--muted)]"
          >
            swap SUI for it on Cetus
          </a>
          .
        </p>
      </section>

      {/* ── Roadmap ── */}
      <section className="space-y-4">
        <div className="text-center space-y-2">
          <div className="mono-label">Coming soon</div>
          <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight">
            Trading, on top of the same key
          </h2>
          <p className="text-xs text-[var(--muted)] max-w-lg mx-auto leading-relaxed">
            Solana first, because that is where the venues and liquidity are — with Sui remaining the
            coordination layer that holds the keys and settles the state.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {ROADMAP.map((r) => (
            <div key={r.title} className="card p-4 space-y-2 border-dashed">
              <div className="flex items-center gap-2">
                <KeyRound className="w-3.5 h-3.5 text-[var(--muted-2)]" aria-hidden />
                <span className="mono-label">Planned</span>
              </div>
              <h3 className="font-bold text-sm">{r.title}</h3>
              <p className="text-xs text-[var(--muted)] leading-relaxed">{r.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Closing call to action ── */}
      <section className="card p-8 sm:p-10 text-center space-y-4">
        <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight">
          Ready in about a minute
        </h2>
        <p className="text-xs text-[var(--muted)] max-w-md mx-auto">
          Sign in and your Sui address exists immediately. Fund it, create your wallets once, and every
          chain above is yours.
        </p>
        <div className="flex justify-center pt-1">
          <ConnectWallet />
        </div>
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-[var(--muted-2)]">
          Takes you to Google <ArrowRight className="w-3 h-3" aria-hidden />
        </p>
      </section>
    </div>
  );
}
