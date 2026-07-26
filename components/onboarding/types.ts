/**
 * The onboarding contract, in a module of its own.
 *
 * `FlowStepper` needs `OnboardStage` and `Onboarding` needs `FlowStepper`, which made the stage type an
 * import cycle between two components. Type-only cycles are erased at build time and so are harmless at
 * runtime, but they are fragile under incremental type-checking and read as an accident. The shared
 * vocabulary belongs to neither component, so it lives here; `Onboarding.tsx` re-exports both names to
 * keep `@/components/onboarding/Onboarding` the single public entry point.
 */

export type OnboardStage = 'fund' | 'create' | 'working' | 'done';

export interface OnboardingProps {
  /** The user's zkLogin Sui address. Show it, make it copyable. */
  address: string;
  /** Formatted SUI balance, e.g. "0.2270". null = still loading. */
  suiBalance: string | null;
  /** Formatted IKA balance. null = still loading. */
  ikaBalance: string | null;
  /** True when the address holds enough of both to proceed. */
  funded: boolean;
  /** Where the user is in the flow. */
  stage: OnboardStage;
  /** During 'working': which step is active, 0-indexed into `steps`. */
  activeStepIndex: number;
  /** During 'working': the current status line from the creation pipeline. */
  statusMessage: string;
  /** Labels for the creation steps, in order. */
  steps: string[];
  /** Set when creation failed. Render it — do NOT reformat the strings. */
  error: { message: string; action?: string; raw: string } | null;
  /** External link where the user can swap SUI for IKA. */
  acquireIkaUrl: string;
  onCreate: () => void;
  onRefreshBalances: () => void;
  onFinish: () => void;
  /** True while balances are being refetched. */
  refreshing: boolean;
}
