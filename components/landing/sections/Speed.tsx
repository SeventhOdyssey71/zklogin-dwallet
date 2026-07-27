'use client';

/**
 * Why an MPC send is not slow, stated as a measurement rather than a promise.
 *
 * Threshold signing has a deserved reputation for being sluggish, so the honest move is to publish the
 * number and its breakdown instead of claiming "fast". The split is the interesting part: nearly
 * three-quarters of the wall clock is Sui and Ika protocol latency, which is the floor for a key that
 * genuinely lives across a network — and the reason the remaining quarter is small is the two things
 * listed below, both of which happen before the user commits to anything.
 */

import { Clock, KeySquare, Layers3 } from 'lucide-react';
import { Reveal, Section, SectionHeader } from './shared';

/** Share of a send spent inside the Sui + Ika protocols. The rest is local work and broadcast. */
/**
   * Share of a send that is Sui + Ika protocol latency rather than our own work.
   *
   * From the measured cold breakdown: the MPC round and the Sui transaction that requests the signature
   * dominate, with the client's wasm and parameter work the remainder. Rounded down deliberately — the
   * claim should understate our share of the blame, not overstate it.
   */
const PROTOCOL_SHARE = 66;

const TACTICS = [
  {
    icon: Layers3,
    title: 'Presignatures are banked',
    body: 'The expensive half of a threshold signature does not depend on the message, so it is computed and pooled in advance. By the time you press Send there is one already waiting.',
  },
  {
    icon: KeySquare,
    title: 'Your share decrypts while you type',
    body: 'Unwrapping the user key share runs the moment the send dialog opens, in parallel with you entering an address and an amount, rather than after you commit.',
  },
  {
    icon: Clock,
    title: 'What is left is network time',
    body: 'Rounds of MPC on Ika, settlement on Sui, then broadcast to the destination chain. That is latency the protocol owes, not overhead the wallet adds.',
  },
];

export function Speed() {
  return (
    <Section id="speed">
      <SectionHeader
        eyebrow="Speed"
        title="Under half a minute a send — and most of it is not us."
        lede="The work that can happen before you press Send already has. What remains is the protocol doing what it is for."
      />

      <Reveal delay={0.06} className="mt-10 sm:mt-12">
        <div className="card p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <p className="num text-3xl sm:text-4xl font-extrabold tracking-[-0.03em]">
              &lt;30<span className="text-[var(--muted-2)]">s</span>
              <span className="ml-3 align-middle text-[11px] font-normal tracking-normal text-[var(--muted)]">
                end to end
              </span>
            </p>
            <p className="text-xs text-[var(--muted)]">
              <span className="num font-bold text-[var(--foreground)]">{PROTOCOL_SHARE}%</span> of it
              Sui + Ika protocol latency
            </p>
          </div>

          {/*
           * Decorative: the same split is written out immediately below in text, so the bar is hidden
           * from assistive tech rather than given a role it would have to fake a value for.
           */}
          <div
            aria-hidden
            className="mt-5 flex h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
          >
            <span
              className="h-full bg-[var(--foreground)]"
              style={{ width: `${PROTOCOL_SHARE}%` }}
            />
            <span className="h-full flex-1 bg-[var(--surface-3)]" />
          </div>

          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 text-[11px]">
            <div className="flex items-center gap-2">
              <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--foreground)]" />
              <dt className="text-[var(--muted)]">Sui + Ika protocol</dt>
              <dd className="num font-bold">{PROTOCOL_SHARE}%</dd>
            </div>
            <div className="flex items-center gap-2">
              <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--surface-3)]" />
              <dt className="text-[var(--muted)]">Local work and broadcast</dt>
              <dd className="num font-bold">{100 - PROTOCOL_SHARE}%</dd>
            </div>
          </dl>
        </div>
      </Reveal>

      <div className="mt-10 grid gap-8 sm:mt-12 lg:grid-cols-3 lg:gap-0">
        {TACTICS.map(({ icon: Icon, title, body }, i) => (
          <Reveal
            key={title}
            delay={0.1 + i * 0.06}
            className="min-w-0 border-t border-[var(--border)] pt-6 lg:border-t-0 lg:border-l lg:px-6 lg:pt-0 lg:first:border-l-0 lg:first:pl-0"
          >
            <Icon className="h-4 w-4 text-[var(--foreground)]" aria-hidden />
            <h3 className="mt-3 text-sm font-bold tracking-[-0.02em]">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)] text-pretty">{body}</p>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
