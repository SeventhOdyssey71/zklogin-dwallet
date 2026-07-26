'use client';

/**
 * Where the user is in setup: Fund → Create → Ready.
 *
 * Onboarding is three screens that each look like a finished page, so without this the user has no way to
 * tell whether funding is the whole task or the first third of it — and the funding screen is exactly
 * where someone abandons, because it asks them to leave the app and come back. Naming the destination up
 * front makes the detour feel like a step rather than a dead end.
 *
 * The drawing is `Stepper`, shared with the swap flow. What belongs to onboarding is the vocabulary below.
 */

import { Stepper } from '@/components/ui';
import type { OnboardStage } from './types';

const PHASES = ['Fund', 'Create', 'Ready'] as const;

/**
 * `working` shares a phase with `create`: from the user's point of view pressing the button and watching
 * it run are one act, and advancing the stepper mid-run would imply a step they still have to take.
 */
const PHASE_OF: Record<OnboardStage, number> = { fund: 0, create: 1, working: 1, done: 2 };

export function FlowStepper({ stage }: { stage: OnboardStage }) {
  return <Stepper phases={PHASES} current={PHASE_OF[stage]} label="Setup progress" />;
}
