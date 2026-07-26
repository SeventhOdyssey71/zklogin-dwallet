'use client';

/**
 * The signed-out page.
 *
 * Composition only — every band owns its own copy, layout and data, so this file stays the one place
 * that answers "what order does the argument go in". That order is deliberate: state the claim (hero),
 * then prove the part that is easiest to doubt (fourteen real chains, listed), then price the
 * commitment (three steps, one of which costs money), then justify the security claim, then answer the
 * objection that MPC is slow, then separate what is planned from what exists, then ask.
 *
 * `onSignIn` is the only behaviour that crosses the boundary. The landing page deliberately knows
 * nothing about zkLogin — it cannot start a session, read one, or tell whether one exists — so it can
 * be rendered, screenshotted and reasoned about without an auth provider above it.
 */

import { MotionConfig } from 'framer-motion';
import { Hero } from './sections/Hero';
import { ChainGrid } from './sections/ChainGrid';
import { HowItWorks } from './sections/HowItWorks';
import { Security } from './sections/Security';
import { Speed } from './sections/Speed';
import { Roadmap } from './sections/Roadmap';
import { FinalCta } from './sections/FinalCta';

export function LandingPage({ onSignIn }: { onSignIn: () => void }): React.ReactElement {
  return (
    /*
     * The global reduced-motion rule collapses CSS animations, but Framer Motion drives its transforms
     * from JavaScript and never sees it. `reducedMotion="user"` is the equivalent switch for this tree:
     * transforms are dropped and opacity is kept, so a reader who asked for less motion still gets the
     * fade that signals content arriving, without anything sliding.
     */
    <MotionConfig reducedMotion="user">
      {/* `overflow-x-clip` is a backstop, not the layout: sections are built to fit, but a landing page
          that can be scrolled sideways by one stray element is a bug the user finds before we do. */}
      <div className="w-full overflow-x-clip">
        <Hero onSignIn={onSignIn} />
        <ChainGrid />
        <HowItWorks onSignIn={onSignIn} />
        <Security />
        <Speed />
        <Roadmap />
        <FinalCta onSignIn={onSignIn} />
      </div>
    </MotionConfig>
  );
}
