'use client';

/**
 * The creation pipeline, as a list the user can watch.
 *
 * Key generation takes about a minute of mostly network waiting, and a lone spinner over that long reads as
 * a hang. Naming the steps turns the wait into visible movement, and it also makes a failure legible: the
 * step it stopped on is the report.
 *
 * Reused unchanged for the success state (`complete`), so "done" is the same list the user was just
 * watching rather than a new screen that discards it.
 */

import { Check, Loader2 } from 'lucide-react';

export function CreationChecklist({
  steps,
  activeStepIndex,
  complete = false,
}: {
  steps: string[];
  /** 0-indexed into `steps`. Ignored when `complete`. */
  activeStepIndex: number;
  complete?: boolean;
}) {
  return (
    <ol className="space-y-2.5">
      {steps.map((label, i) => {
        const done = complete || i < activeStepIndex;
        const active = !complete && i === activeStepIndex;
        return (
          <li
            key={`${i}-${label}`}
            aria-current={active ? 'step' : undefined}
            className="flex items-start gap-3 text-left"
          >
            <span
              className={`w-6 h-6 shrink-0 rounded-full grid place-items-center text-[11px] border transition ${
                done
                  ? 'bg-[var(--foreground)] text-black border-[var(--foreground)]'
                  : active
                    ? 'border-[var(--foreground)] text-[var(--foreground)]'
                    : 'border-[var(--border)] text-[var(--muted-2)]'
              }`}
            >
              {done ? (
                <Check className="w-3.5 h-3.5" aria-hidden />
              ) : active ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              ) : (
                i + 1
              )}
            </span>
            <span
              className={`text-sm leading-6 min-w-0 break-words ${
                active
                  ? 'text-[var(--foreground)] font-semibold'
                  : done
                    ? 'text-[var(--muted)]'
                    : 'text-[var(--muted-2)]'
              }`}
            >
              {label}
              {/* State is carried by colour and icon alone otherwise. */}
              {done && <span className="sr-only"> (complete)</span>}
              {active && <span className="sr-only"> (in progress)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
