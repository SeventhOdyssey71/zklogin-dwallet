'use client';

/**
 * The split-key claim, stated so it can be checked.
 *
 * "Non-custodial" is a word every custodian also uses, so the section argues from the mechanism instead:
 * what the two shares are, who holds each, and what each holder can compute on their own. The diagram is
 * the load-bearing part — the reason neither party can act alone is structural, and a reader who sees the
 * structure does not have to take the sentence on trust.
 */

import { KeyRound, Network, PenLine, X } from 'lucide-react';
import { Reveal, Section, SectionHeader } from './shared';

/** Stated as capabilities nobody has, because that is the part that is falsifiable. */
const CANNOT = [
  'We cannot sign a transaction for you, or move funds without your device.',
  'The validator network cannot sign for you either — its share is half of a key.',
  'A single compromised share computes nothing. One share is not a key.',
];

const SHARES = [
  {
    icon: KeyRound,
    label: 'Share one',
    holder: 'Your browser',
    body: 'Held encrypted and decrypted locally, in the session derived from your Google login.',
  },
  {
    icon: Network,
    label: 'Share two',
    holder: 'Ika validator network',
    body: 'Distributed across the network at key generation. It never sees your half.',
  },
];

export function Security() {
  return (
    <Section id="security">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-16">
        <div className="min-w-0">
          <SectionHeader
            eyebrow="Security · Ika 2PC-MPC v4"
            title="The whole key never exists."
            lede="Every key is generated already split. There is no moment — not at creation, not while signing — when one machine holds enough material to move your funds."
          />

          <Reveal delay={0.06} className="mt-8 space-y-4 max-w-2xl">
            <p className="text-sm leading-relaxed text-[var(--muted)] text-pretty">
              Signing is a protocol run between your browser and the validator network. Each side
              contributes to the signature using its own share and learns nothing about the other&apos;s.
              The output is an ordinary signature that Bitcoin, Ethereum or Solana verify like any other —
              the difference is only in how it was produced.
            </p>
            <p className="text-sm leading-relaxed text-[var(--muted)] text-pretty">
              Sui is the coordination layer. It holds the key objects and settles the state, so what your
              wallet is and what it has done is a public on-chain record rather than a row in our
              database.
            </p>
          </Reveal>

          <Reveal delay={0.12} className="mt-8 border-t border-[var(--border)] pt-6">
            <h3 className="mono-label">What nobody can do</h3>
            <ul className="mt-4 space-y-3">
              {CANNOT.map((line) => (
                <li key={line} className="flex gap-3 text-sm leading-relaxed">
                  <X className="mt-1 h-3.5 w-3.5 shrink-0 text-[var(--muted-2)]" aria-hidden />
                  <span className="text-[var(--muted)] text-pretty">{line}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        {/*
         * The diagram. Ordered top to bottom with the operators between the cards, so it reads as an
         * equation on a phone as well as on a desktop — a left-to-right diagram would have to be
         * redrawn at every breakpoint to say the same thing.
         */}
        <Reveal delay={0.16} className="min-w-0">
          <ul className="space-y-2">
            {SHARES.map(({ icon: Icon, label, holder, body }, i) => (
              <li key={label}>
                <div className="card p-4">
                  <div className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4 shrink-0 text-[var(--foreground)]" aria-hidden />
                    <span className="mono-label">{label}</span>
                  </div>
                  <p className="mt-3 text-sm font-bold tracking-[-0.02em]">{holder}</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">{body}</p>
                </div>
                {i === 0 && (
                  <div aria-hidden className="py-2 text-center text-sm text-[var(--muted-2)]">
                    +
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div aria-hidden className="py-2 text-center text-sm text-[var(--muted-2)]">
            =
          </div>

          <div className="rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--surface-2)] p-4">
            <div className="flex items-center gap-2.5">
              <PenLine className="h-4 w-4 shrink-0" aria-hidden />
              <span className="mono-label text-[var(--foreground)]">Result</span>
            </div>
            <p className="mt-3 text-sm font-bold tracking-[-0.02em]">One valid signature</p>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
              Computed jointly. Either share on its own is inert.
            </p>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
