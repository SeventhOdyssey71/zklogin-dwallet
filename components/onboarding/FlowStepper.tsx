'use client';

/**
 * Where the user is in setup: Fund → Create → Ready.
 *
 * Onboarding is three screens that each look like a finished page, so without this the user has no way to
 * tell whether funding is the whole task or the first third of it — and the funding screen is exactly
 * where someone abandons, because it asks them to leave the app and come back. Naming the destination up
 * front makes the detour feel like a step rather than a dead end.
 */

import { Check } from 'lucide-react';
import type { OnboardStage } from './types';

const PHASES = ['Fund', 'Create', 'Ready'] as const;

/**
 * `working` shares a phase with `create`: from the user's point of view pressing the button and watching
 * it run are one act, and advancing the stepper mid-run would imply a step they still have to take.
 */
const PHASE_OF: Record<OnboardStage, number> = { fund: 0, create: 1, working: 1, done: 2 };

export function FlowStepper({ stage }: { stage: OnboardStage }) {
  const current = PHASE_OF[stage];

  return (
    <nav aria-label="Setup progress">
      <ol className="flex items-center">
        {PHASES.map((label, i) => {
          const done = i < current;
          const active = i === current;
          const last = i === PHASES.length - 1;
          return (
            <li
              key={label}
              // `aria-current="step"` is the only signal a screen reader gets here; the ring and the
              // brighter label are invisible to it.
              aria-current={active ? 'step' : undefined}
              className={`flex items-center gap-2 min-w-0 ${last ? '' : 'flex-1'}`}
            >
              <span
                className={`w-6 h-6 shrink-0 rounded-full grid place-items-center text-[10px] font-bold border transition ${
                  done
                    ? 'bg-[var(--foreground)] text-black border-[var(--foreground)]'
                    : active
                      ? 'border-[var(--foreground)] text-[var(--foreground)]'
                      : 'border-[var(--border)] text-[var(--muted-2)]'
                }`}
              >
                {done ? <Check className="w-3 h-3" aria-hidden /> : i + 1}
              </span>
              <span
                className={`mono-label truncate ${
                  active ? 'text-[var(--foreground)]' : done ? '' : 'text-[var(--muted-2)]'
                }`}
              >
                {label}
                {done && <span className="sr-only"> (complete)</span>}
              </span>
              {/* The connector belongs to the step before it, so it fills whatever width is left after
                  both labels — which is how the row stays on one line at 375px. */}
              {!last && (
                <span
                  aria-hidden
                  className={`h-px flex-1 min-w-3 ml-1 ${
                    done ? 'bg-[var(--border-strong)]' : 'bg-[var(--border)]'
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
