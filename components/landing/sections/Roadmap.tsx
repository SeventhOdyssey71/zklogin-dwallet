'use client';

/**
 * What is planned, marked so it cannot be mistaken for what exists.
 *
 * Everything above this line is shipped and on mainnet today; nothing below it is. That distinction is
 * the only thing this section has to get right, so it is carried three ways at once — the eyebrow, a
 * `Planned` tag on every card, and dashed borders against the solid ones used everywhere else. A
 * roadmap item that reads as a feature is a lie the page tells by accident.
 *
 * The sequencing is stated rather than implied. "Solana first" is a decision with a reason, and giving
 * the reason is what separates a plan from a wish list.
 */

import { motion } from 'framer-motion';
import {
  PlannedTag,
  Reveal,
  Section,
  SectionHeader,
  STAGGER_CHILD,
  STAGGER_PARENT,
} from './shared';

const PLANNED = [
  {
    title: 'DeFi swaps',
    body: 'Routing through Solana venues, signed by the same dWallet that holds the balance. No deposit into an exchange account, no separate key.',
  },
  {
    title: 'Perpetuals',
    body: 'Perps on Solana venues, with the position held by your MPC key rather than by the venue on your behalf.',
  },
  {
    title: 'Spot trading',
    body: 'Order placement across Solana markets from inside the wallet, against the balance already sitting at your Solana address.',
  },
];

export function Roadmap() {
  return (
    <Section id="roadmap">
      <SectionHeader
        eyebrow="Roadmap · not shipped"
        title="Trading, on top of the same key."
        lede="Solana first, because that is where the venues and the liquidity are. More chains follow once the Solana path is proven end to end — with Sui still the coordination layer holding the keys and settling state."
      />

      <motion.ul
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-72px' }}
        variants={STAGGER_PARENT}
        className="mt-10 grid gap-3 sm:mt-12 lg:grid-cols-3"
      >
        {PLANNED.map((p) => (
          <motion.li
            key={p.title}
            variants={STAGGER_CHILD}
            /* Unfilled on purpose. Every shipped card on this page sits on `--surface`; leaving these on
               the page background lets the dotted backdrop show through, so "not built yet" is legible
               from the shape of the card before any of its text is read. */
            className="min-w-0 rounded-[var(--radius)] border border-dashed border-[var(--border)] p-5"
          >
            <PlannedTag />
            <h3 className="mt-3.5 text-base font-bold tracking-[-0.02em] text-[var(--muted)]">
              {p.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted-2)] text-pretty">{p.body}</p>
          </motion.li>
        ))}
      </motion.ul>

      <Reveal delay={0.24}>
        <p className="mt-6 text-[11px] leading-relaxed text-[var(--muted-2)]">
          None of the above is live today. Signing in gets you the wallet described further up this
          page — {' '}
          <span className="text-[var(--muted)]">addresses, balances, sending and receiving</span>.
        </p>
      </Reveal>
    </Section>
  );
}
