'use client';

/**
 * Run expensive work only when the user is not in the middle of something.
 *
 * THE PROBLEM THIS EXISTS FOR
 * ---------------------------
 * Warming the signing path is worth seconds off a send, and it was therefore started as early as
 * possible: the moment the send dialog opened, the moment the swap page mounted. But that work is
 * wasm, it is synchronous, and it is measured in seconds — 3.5s to convert the protocol parameters,
 * longer to decrypt the key share. While it runs, the main thread cannot do anything else.
 *
 * Which meant the warm-up landed squarely on top of the user typing a recipient and an amount. The
 * keystrokes were accepted, but React could not re-render, so the field went on showing an older value:
 * type "0.005" and watch it sit at "0.0" for a couple of seconds. Reproduced in a browser, where every
 * keystroke during a blocking task left the input displaying its previous contents.
 *
 * Moving the work off the critical path of *sending* had put it on the critical path of *typing*.
 *
 * WHAT THIS DOES, AND WHAT IT DOES NOT
 * ------------------------------------
 * It waits for a quiet moment — no keystrokes, no pointer input — before starting, and pushes the start
 * back every time the user does something. A pause of a few hundred milliseconds is enough, so in
 * practice the work begins the instant someone stops typing and is done well before they press the
 * button.
 *
 * It does NOT make the work interruptible. Once a wasm call starts it holds the thread until it
 * finishes; nothing in JavaScript can pre-empt it. So this removes the collision, not the underlying
 * single-threadedness — the complete answer is to run the wasm in a worker, which is a much larger
 * change than this one.
 *
 * `maxWaitMs` guarantees the work eventually runs even if the user never stops fidgeting, because a
 * warm-up that never happens is worse than one that happens at an awkward moment.
 */

/** Events that mean "the user is doing something right now". */
const ACTIVITY = ['keydown', 'input', 'pointerdown', 'wheel'] as const;

export interface WhenIdleOptions {
  /** Quiet period required before starting. Long enough to span the gap between two keystrokes. */
  quietMs?: number;
  /** Start regardless after this long, so the work is never postponed forever. */
  maxWaitMs?: number;
}

/**
 * Schedule `fn` for the next quiet moment. Returns a cancel function.
 *
 * Safe to call during render-adjacent code paths: nothing runs synchronously.
 */
export function runWhenIdle(fn: () => void, options: WhenIdleOptions = {}): () => void {
  const quietMs = options.quietMs ?? 500;
  const maxWaitMs = options.maxWaitMs ?? 10_000;

  if (typeof window === 'undefined') {
    // No user to interrupt on the server; run on the next tick so the caller is never blocked.
    const t = setTimeout(fn, 0);
    return () => clearTimeout(t);
  }

  let done = false;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;

  const cleanup = () => {
    if (quietTimer) clearTimeout(quietTimer);
    clearTimeout(deadline);
    for (const type of ACTIVITY) window.removeEventListener(type, bump, true);
  };

  const start = () => {
    if (done) return;
    done = true;
    cleanup();
    /**
     * One more hop through `requestIdleCallback` where it exists.
     *
     * The quiet period says the user has stopped; this additionally waits for the browser to have
     * finished any rendering it still owed, so the work does not begin a frame before a pending paint.
     */
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
      .requestIdleCallback;
    if (idle) idle(() => fn(), { timeout: 1_000 });
    else setTimeout(fn, 0);
  };

  /** Any activity pushes the start back by another quiet period. */
  const bump = () => {
    if (done) return;
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(start, quietMs);
  };

  const deadline = setTimeout(start, maxWaitMs);
  for (const type of ACTIVITY) window.addEventListener(type, bump, true);
  quietTimer = setTimeout(start, quietMs);

  return () => {
    done = true;
    cleanup();
  };
}
