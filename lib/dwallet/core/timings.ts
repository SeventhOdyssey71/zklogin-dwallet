'use client';

/**
 * Phase timing for the send path.
 *
 * "It took almost a minute and I don't know why" is not a debuggable report, and it was impossible to
 * answer from the old logs: they printed step *markers* with no durations, so a step that took 15s and
 * one that took 15ms looked identical. This records each phase and prints one compact table at the
 * end, so the next slow send explains itself without adding instrumentation after the fact.
 *
 * Deliberately always on (unlike the verbose `debug` logs) — it is a handful of lines and it is the
 * only thing that makes a latency regression visible.
 */

export interface Phase {
  name: string;
  ms: number;
}

export class Timings {
  private readonly started = performance.now();
  private readonly phases: Phase[] = [];

  constructor(private readonly label: string) {}

  /** Time an async phase. */
  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      this.phases.push({ name, ms: performance.now() - t0 });
    }
  }

  /** Record a phase measured elsewhere (e.g. one that ran concurrently). */
  note(name: string, ms: number): void {
    this.phases.push({ name, ms });
  }

  /** Wall-clock so far. */
  get elapsed(): number {
    return performance.now() - this.started;
  }

  /**
   * Print the breakdown.
   *
   * The phase sum can exceed the total when phases overlap — that is the point, since overlap is what
   * we are trying to create. Each row shows its share of wall-clock so the dominant cost is obvious.
   */
  report(): void {
    const total = this.elapsed;
    const width = Math.max(...this.phases.map((p) => p.name.length), 10);
    const lines = this.phases.map((p) => {
      const pct = total > 0 ? Math.round((p.ms / total) * 100) : 0;
      const bar = '█'.repeat(Math.min(20, Math.round(pct / 5)));
      return `  ${String(Math.round(p.ms)).padStart(6)} ms  ${String(pct).padStart(3)}%  ${p.name.padEnd(width)} ${bar}`;
    });
    console.log(
      `\n⏱️  ${this.label} — ${(total / 1000).toFixed(1)}s total\n${lines.join('\n')}\n` +
        `  ${String(Math.round(total)).padStart(6)} ms  100%  ${'wall clock'.padEnd(width)}\n`
    );
  }
}
