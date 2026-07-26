'use client';

/**
 * Layout chrome shared by every landing band.
 *
 * Each section previously carried its own container, padding and heading markup, which is how a landing
 * page ends up with four different max-widths and three different vertical rhythms. Centralising the
 * three decisions that must be identical everywhere — measure, gutter, rhythm — means a change to the
 * page's proportions is one edit, and no section can quietly drift out of alignment with its neighbours.
 */

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

/**
 * The page's measure and gutter.
 *
 * Exported rather than only used by `Section` because the hero needs a full-bleed element (its glow)
 * outside the container while its text stays inside it, so it composes the container itself.
 */
export const CONTAINER = 'mx-auto w-full max-w-6xl px-4 sm:px-6';

/**
 * One band of the page.
 *
 * The hairline is on the `<section>` rather than a separate `<hr>`: at the widths this page is read at,
 * a divider that stops short of the viewport edge reads as a mistake, and a border on the band itself
 * spans whatever width the band was given.
 *
 * `scroll-mt-24` exists because the app's header is `sticky` — without it an in-page anchor lands the
 * heading underneath the header.
 */
export function Section({
  id,
  className = '',
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      /* No `/opacity` modifier on the border: Tailwind v4 cannot tell that `var(--border)` holds a
         colour, so it emits the utility with the alpha silently discarded. A softer rule has to come
         from a different variable, not from a modifier that does nothing. */
      className={`scroll-mt-24 border-t border-[var(--border)] py-20 sm:py-24 lg:py-32 ${className}`}
    >
      <div className={CONTAINER}>{children}</div>
    </section>
  );
}

/**
 * A band's heading block.
 *
 * The eyebrow is a `<p>`, not a heading: it is a label for the `<h2>` beneath it, and promoting it to
 * `<h3>` (which is what "small text above a big heading" tends to become) would put the document
 * outline in the wrong order for anyone navigating by headings.
 */
export function SectionHeader({
  eyebrow,
  title,
  lede,
  align = 'left',
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  align?: 'left' | 'center';
}) {
  const centered = align === 'center';
  return (
    <Reveal className={`max-w-2xl ${centered ? 'mx-auto text-center' : ''}`}>
      <p className="mono-label">{eyebrow}</p>
      <h2 className="mt-4 text-2xl sm:text-3xl lg:text-[2.5rem] font-extrabold leading-[1.08] tracking-[-0.03em] text-balance">
        {title}
      </h2>
      {lede && (
        <p className="mt-4 text-sm sm:text-[15px] leading-relaxed text-[var(--muted)] text-pretty">
          {lede}
        </p>
      )}
    </Reveal>
  );
}

/**
 * Enter-on-scroll, once.
 *
 * Deliberately a 14px lift and nothing else. Anything larger turns reading the page into waiting for it,
 * and `once` matters as much as the distance: content that re-animates every time it re-enters the
 * viewport makes scrolling back up feel broken. `MotionConfig reducedMotion="user"` in `LandingPage`
 * strips the transform for anyone who has asked the OS for less motion, leaving the fade.
 */
export function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      // A negative margin holds the reveal until the element is properly on screen, so it isn't already
      // finished by the time it is worth looking at.
      viewport={{ once: true, margin: '-72px' }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Grid stagger, as variants — one scroll observer for the whole grid instead of one per cell. */
export const STAGGER_PARENT = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035 } },
} as const;

export const STAGGER_CHILD = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } },
} as const;

/**
 * "Planned, not shipped."
 *
 * A roadmap that looks like a feature list is a promise the product has not made. This is the visual
 * marker that separates the two, so it is a component rather than a class string repeated per card.
 */
export function PlannedTag() {
  return (
    <span className="mono-label inline-flex items-center gap-1.5 text-[var(--muted-2)]">
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full border border-[var(--muted-2)] bg-transparent"
      />
      Planned
    </span>
  );
}
