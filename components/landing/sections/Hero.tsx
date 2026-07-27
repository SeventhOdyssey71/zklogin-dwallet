'use client';

/**
 * Above the fold.
 *
 * One claim, one action. The headline states the whole product in two clauses because a visitor who
 * reads nothing else should still be able to say what ycos is; the second clause is muted rather than a
 * smaller size, which keeps the hierarchy without introducing a third type scale.
 *
 * The stat strip is the only other thing here. It exists to make the headline checkable — a number a
 * reader can hold onto beats another adjective — and every figure is substantiated further down the
 * page rather than asserted only here.
 */

import { ArrowRight } from 'lucide-react';
import { LogoMark, Wordmark } from '@/components/brand/Logo';
import { Button } from '@/components/ui';
import { CHAINS } from '@/lib/config/chainRegistry';
import { CONTAINER, Reveal } from './shared';

const CHAIN_COUNT = CHAINS.length;

/** Figures a reader can check against the rest of the page, not adjectives. */
const STATS: { value: string; unit?: string; label: string }[] = [
  { value: String(CHAIN_COUNT), label: 'chains, one account' },
  /**
   * Stated as a ceiling, not a point estimate.
   *
   * "~13s" was measured on a warm send — banked presignature, decrypted share, cached proof. A cold one
   * measured 28.2s, and a first send after opening the app is cold by definition. Advertising the warm
   * number as the typical one is a promise the app breaks on the run that matters most: the first.
   */
  { value: '<30', unit: 's', label: 'end to end, per send' },
  { value: '0', label: 'seed phrases to keep' },
];

export function Hero({ onSignIn }: { onSignIn: () => void }) {
  return (
    /* `overflow-clip` rather than `overflow-hidden`: the glow is positioned above this section and has to
       be trimmed so it does not paint over the header, but `hidden` would also make this a scroll
       container — which brings scroll anchoring and clipped focus rings with it for no benefit. */
    <section className="relative overflow-clip pt-12 pb-20 sm:pt-20 sm:pb-24 lg:pt-24 lg:pb-32">
      {/*
       * A single soft light source behind the headline. The body already carries a dotted grid, so this
       * is only here to stop the top of the page reading as flat black — hence one gradient, no second
       * accent, and `pointer-events-none` so it can never eat a click on the CTA.
       */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 h-[520px] bg-[radial-gradient(55%_55%_at_50%_0%,rgba(255,255,255,0.10),rgba(255,255,255,0)_70%)]"
      />

      <div className={`relative ${CONTAINER}`}>
        <Reveal className="max-w-4xl">
          {/*
           * The name and what it stands for, before anything else. "ycos" is a new word to every visitor
           * and an unexplained one in the headline would cost more attention than it buys, so the
           * expansion is paid off here rather than in the lede where it was competing with the claim.
           */}
          <p className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-2.5 pr-3">
            <LogoMark className="h-3.5 w-3.5 shrink-0" />
            <Wordmark className="text-[12px]" />
            <span aria-hidden className="h-3 w-px bg-[var(--border)]" />
            <span className="mono-label">Your chain on Sui</span>
          </p>

          {/*
           * Sizes are set against a monospace advance width, not a proportional one. JetBrains Mono is
           * 0.6em per character, so "13 chains. No seed phrase." is ~26 × 0.6em wide with no narrow
           * glyphs to absorb the difference — a scale that looks conservative in a proportional face
           * pushes past a 375px viewport here. Each step is sized so the two lines hold at their
           * breakpoint rather than wrapping into a ragged third.
           */}
          <h1 className="mt-7 text-[1.75rem] sm:text-[2.5rem] lg:text-[3.5rem] font-extrabold leading-[1.03] tracking-[-0.045em] text-balance">
            One Google login.
            <br />
            <span className="text-[var(--muted)]">
              {CHAIN_COUNT} chains. No seed phrase.
            </span>
          </h1>

          <p className="mt-7 max-w-xl text-sm sm:text-base leading-relaxed text-[var(--muted)] text-pretty">
            Real addresses on {CHAIN_COUNT} blockchains, derived from your Google account, with every key
            split across a validator network so no single party — including us — can sign alone.
          </p>
        </Reveal>

        <Reveal delay={0.08} className="mt-9">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <Button
              size="lg"
              onClick={onSignIn}
              icon={<ArrowRight className="h-4 w-4 shrink-0" aria-hidden />}
              className="w-full sm:w-auto sm:min-w-[13rem]"
            >
              Sign in with Google
            </Button>
            {/*
             * An anchor, not a button: it navigates within the document, so it has to be middle-clickable
             * and it has to survive being copied as a link. Styled to match the secondary button.
             */}
            <a
              href="#how"
              className="inline-flex w-full sm:w-auto items-center justify-center gap-2 whitespace-nowrap rounded-[12px] border border-[var(--border)] px-6 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]"
            >
              How it works
            </a>
          </div>
          <p className="mt-4 text-[11px] text-[var(--muted-2)]">
            Mainnet · real assets · irreversible transactions
          </p>
        </Reveal>

        {/*
         * Three figures on hairline-divided columns. `divide-x` on a grid rather than borders on each
         * cell, so there is no trailing rule on the last column at any breakpoint.
         *
         * `flex-col-reverse` puts the figure above its label visually while keeping `dt` before `dd` in
         * the DOM — a description list read out as "value, label" is backwards, and duplicating the
         * label into a visually-hidden `dt` would just make a screen reader say it twice.
         */}
        <Reveal delay={0.16} className="mt-16 sm:mt-20">
          <dl className="grid grid-cols-3 divide-x divide-[var(--border)] border-y border-[var(--border)]">
            {STATS.map((s) => (
              <div
                key={s.label}
                className="flex flex-col-reverse gap-1.5 px-2.5 py-5 first:pl-0 sm:px-5"
              >
                <dt className="text-[11px] leading-snug text-[var(--muted)]">{s.label}</dt>
                <dd className="num text-2xl sm:text-3xl font-extrabold tracking-[-0.03em]">
                  {s.value}
                  {s.unit && <span className="font-bold text-[var(--muted-2)]">{s.unit}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </section>
  );
}
