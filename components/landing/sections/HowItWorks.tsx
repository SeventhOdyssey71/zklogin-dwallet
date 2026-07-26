'use client';

/**
 * The whole commitment, before signing in.
 *
 * Three steps, and the second one says out loud that it costs money. Burying "you will need to hold two
 * tokens" until after the OAuth redirect is how onboarding funnels get abandoned at the point where the
 * user has already handed over an identity — so the funding requirement, and where IKA actually comes
 * from, are stated here rather than discovered later.
 */

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui';
import { CHAINS } from '@/lib/config/chainRegistry';
import { IKA_ACQUIRE_URL } from '@/lib/config/network';
import { Reveal, Section, SectionHeader, STAGGER_CHILD, STAGGER_PARENT } from './shared';

const STEPS: { n: string; title: string; body: ReactNode }[] = [
  {
    n: '01',
    title: 'Sign in with Google',
    body: 'zkLogin derives a Sui address from your Google account. Nothing to install, nothing to write down — the address exists the moment you land back here.',
  },
  {
    n: '02',
    title: 'Fund it with SUI and IKA',
    body: (
      <>
        SUI pays gas on Sui; IKA pays the 2PC-MPC signing fees. Mainnet has no faucet, so IKA comes from
        a{' '}
        <a
          href={IKA_ACQUIRE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--foreground)] underline decoration-[var(--border-strong)] underline-offset-4 transition hover:decoration-[var(--foreground)]"
        >
          SUI → IKA swap on Cetus
        </a>
        .
      </>
    ),
  },
  {
    n: '03',
    title: 'Create your wallets, once',
    body: `One pass of distributed key generation produces the keys behind all ${CHAINS.length} chains. After that every address is permanent, and every send reuses the same keys.`,
  },
];

export function HowItWorks({ onSignIn }: { onSignIn: () => void }) {
  return (
    <Section id="how">
      <SectionHeader
        eyebrow="How it works"
        title="Three steps, then it is just a wallet."
        lede="Setup happens once. Everything after it is sending and receiving."
      />

      {/*
       * The rule always separates along the reading direction: above each step while they are stacked,
       * to the left of each once they sit side by side.
       */}
      <motion.ol
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-72px' }}
        variants={STAGGER_PARENT}
        className="mt-10 grid gap-8 sm:mt-12 lg:grid-cols-3 lg:gap-0"
      >
        {STEPS.map((s) => (
          <motion.li
            key={s.n}
            variants={STAGGER_CHILD}
            className="min-w-0 border-t border-[var(--border)] pt-6 lg:border-t-0 lg:border-l lg:px-6 lg:pt-0 lg:first:border-l-0 lg:first:pl-0"
          >
            <span className="num mono-label block text-[var(--muted-2)]">{s.n}</span>
            <h3 className="mt-3 text-base font-bold tracking-[-0.02em]">{s.title}</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-[var(--muted)] text-pretty">{s.body}</p>
          </motion.li>
        ))}
      </motion.ol>

      <Reveal delay={0.2} className="mt-10 sm:mt-12">
        <Button variant="secondary" size="lg" onClick={onSignIn} className="w-full sm:w-auto">
          Start with step one
        </Button>
      </Reveal>
    </Section>
  );
}
