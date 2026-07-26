'use client';

/**
 * The last ask.
 *
 * Nothing new is argued here — a closing section that introduces a fresh claim is one the reader has to
 * evaluate instead of act on. It restates the shape of the commitment (one login, one funding step, one
 * setup) and repeats the two warnings that matter, because this is the click that leaves the site.
 */

import { ArrowRight } from 'lucide-react';
import { LogoMark } from '@/components/brand/Logo';
import { Button } from '@/components/ui';
import { CHAINS } from '@/lib/config/chainRegistry';
import { Reveal, Section } from './shared';

export function FinalCta({ onSignIn }: { onSignIn: () => void }) {
  return (
    <Section id="start">
      <Reveal className="mx-auto max-w-2xl text-center">
        <LogoMark className="mx-auto h-10 w-10 text-[var(--foreground)]" />

        <h2 className="mt-7 text-2xl sm:text-3xl lg:text-[2.5rem] font-extrabold leading-[1.08] tracking-[-0.03em] text-balance">
          Your chain, on Sui.
        </h2>

        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-[var(--muted)] text-pretty">
          Sign in and your Sui address exists immediately. Fund it, create your wallets once, and all{' '}
          {CHAINS.length} chains are yours.
        </p>

        <div className="mt-8 flex justify-center">
          <Button
            size="lg"
            onClick={onSignIn}
            icon={<ArrowRight className="h-4 w-4 shrink-0" aria-hidden />}
            className="w-full sm:w-auto sm:min-w-[13rem]"
          >
            Sign in with Google
          </Button>
        </div>

        <p className="mt-4 text-[11px] text-[var(--muted-2)]">
          Takes you to Google · mainnet · real assets · irreversible transactions
        </p>
      </Reveal>
    </Section>
  );
}
