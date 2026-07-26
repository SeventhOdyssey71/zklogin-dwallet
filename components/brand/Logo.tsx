/**
 * ycos brand identity — "Your Chain On Sui".
 *
 * The mark is three strokes converging on a single point: two arms descend from the upper corners,
 * meet at the optical centre, and continue as one stem. That is the product in one gesture — many
 * chains arriving at one coordinating layer — and it doubles as the `y` of the wordmark, so the
 * symbol and the name reinforce each other instead of competing.
 *
 * Why it survives 16px, which is where most logos die: it is a single open path with no enclosed
 * counters, no overlapping shapes and no fills to thin out. At a 32px viewBox a 3.5-unit stroke is
 * ~1.75 CSS px at favicon size (3.5 device px on a 2x screen), and the three terminals stay ≥6 units
 * apart, so the arms never fuse into a blob when the rasteriser rounds them. Round caps and joins
 * mean the vertex reads as a junction rather than a spike, again a hinting problem at small sizes.
 *
 * Everything inherits `currentColor`; there are no hardcoded colours here so a caller can put the
 * mark on any surface — including a dark-on-light context — without a second variant existing.
 */

/**
 * The convergence path, shared by every consumer of the mark.
 *
 * Kept as one string with two subpaths (arms, then stem) so the arm vertex gets a real stroke join
 * while the stem starts from the same coordinate with a cap — visually a seamless junction from a
 * single `<path>`, which is also what keeps the `next/og` icon route (app/icon.tsx) and this
 * component provably identical rather than two drawings that drift apart.
 */
export const MARK_PATH = 'M6.5 7 16 16.5 25.5 7M16 16.5V26';
export const MARK_STROKE_WIDTH = 3.5;

/** True when the caller has already specified a box size, so we should not fight them with ours. */
function hasSizeClass(className: string): boolean {
  return /(?:^|\s)(?:w-|h-|size-)/.test(className);
}

/** True when the caller has specified a font size (not merely a text *colour* such as `an arbitrary text-colour utility`). */
function hasTextSizeClass(className: string): boolean {
  return /(?:^|\s)text-(?:xs|sm|base|lg|\d*xl|\[\d)/.test(className);
}

/**
 * The symbol alone: square, no padding of its own, no text.
 *
 * `aria-hidden` is unconditional. The mark never carries the accessible name — either it sits beside
 * the wordmark (which is real text) or the surrounding control supplies its own label. Announcing
 * "ycos" twice is worse than not announcing the glyph at all.
 *
 * Sizing defaults to `w-6 h-6` but is skipped entirely if the caller passes a width/height utility:
 * Tailwind resolves same-property conflicts by stylesheet order, not by class order, so appending
 * `w-8` after `w-6` is not reliably a win. Detecting the intent is.
 */
export function LogoMark({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={MARK_STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`${hasSizeClass(className) ? '' : 'w-6 h-6'} ${className}`}
    >
      <path d={MARK_PATH} />
    </svg>
  );
}

/**
 * The wordmark: always lowercase `ycos`, never capitalised, never all-caps.
 *
 * Negative tracking is doing real work here. JetBrains Mono is a fixed-pitch face, so a four-letter
 * word set at its natural advance width reads as four separate glyphs rather than one word; pulling
 * the letters in undoes just enough of the monospacing to make it a wordmark while keeping the
 * mechanical, terminal-adjacent character that the rest of the UI is built on.
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`font-mono font-extrabold tracking-[-0.07em] leading-none select-none ${
        hasTextSizeClass(className) ? '' : 'text-[17px]'
      } ${className}`}
    >
      ycos
    </span>
  );
}

/**
 * Mark plus wordmark, optically aligned.
 *
 * The gap is deliberately tighter than the mark's own side bearings so the pair reads as one lockup
 * instead of an icon that happens to sit next to a label. `showWordmark` defaults to true because the
 * only places that want the bare symbol (favicon, collapsed nav, loading state) are the exceptions.
 */
export function Logo({
  className = '',
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[var(--foreground)] ${className}`}>
      <LogoMark />
      {showWordmark ? <Wordmark /> : null}
    </span>
  );
}
