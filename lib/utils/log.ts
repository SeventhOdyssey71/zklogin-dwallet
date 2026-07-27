/**
 * The one place that decides whether a line reaches the user's console.
 *
 * WHY THIS EXISTS
 * ---------------
 * A send narrated itself in emoji — presign acquired, signature received, broadcasting to NEAR,
 * a phase-timing table — and a balance sweep announced every endpoint it took out of rotation. All
 * of it is genuinely useful while developing and none of it means anything to someone who just sent
 * 0.005 SOL. Worse, the noise buried the two or three lines that *would* have explained a real
 * failure, so "check the console" stopped being useful advice.
 *
 * There were already three attempts at gating this and each one leaked:
 *
 *   - `NEXT_PUBLIC_DEBUG_SIGNING` in clientSideSigning.ts gated the verbose trace but deliberately
 *     left the numbered step markers as plain `console.log`, on the reasoning that progress should
 *     stay visible. Progress belongs in the UI (`onProgress` already carries it), not the console.
 *   - `NEXT_PUBLIC_DEBUG_BALANCES` in deriveAddresses.ts was wired to a `debug` helper that called
 *     *itself* — enabling it would have stack-overflowed, so that gate had never actually run.
 *   - The chain signers (near, cardano, solana, ethereum, bitcoin) had no gate at all.
 *
 * And all three shared a fatal flaw for support: `NEXT_PUBLIC_*` is inlined at build time, so a user
 * hitting a bug in production had no way to turn logging on, and we had no way to ask them to. That
 * is what the localStorage hatch below is for.
 *
 * WHERE THE LINE IS DRAWN
 * -----------------------
 * The distinction is not severity, it is *whether the code already knows what to do about it*:
 *
 *   debug()   Narration. "Broadcasting to NEAR", "presignature ready", the timing table. Interesting
 *             to a developer, meaningless to a user. Silent in production.
 *
 *   warn()    A condition the code anticipated and handled: an RPC endpoint rotating out on its
 *             circuit breaker, an unfunded NEAR account read as a zero balance, a Solana blockhash
 *             that expired and was retried with preflight skipped, a Redis cache that is absent. The
 *             wallet is working correctly; the user has nothing to act on. Silent in production.
 *
 *   error()   An outcome nobody planned for, where the user is about to see something break and a
 *             bug report is the likely next step: a Sui sign transaction returning a failure status,
 *             a signature whose session id cannot be found, a transaction that reverted on chain.
 *             **Always printed, production included.**
 *
 * Deliberately NOT blanket-suppressing `console.error` is the point. A silent production build makes
 * every bug report undiagnosable, and errors are rare by construction — they do not spam a console
 * that is otherwise quiet. If an `error()` fires on a normal, healthy session, that is a signal the
 * call site is misclassified and belongs in `warn()`, not a reason to widen the gate.
 *
 * A caught exception that the caller surfaces in the UI (a toast, an inline message) is a judgement
 * call: it stays at `error()` when the exception is unexpected — a network fault mid-send, an SDK
 * throwing from a path we believed total — because the toast tells the user *that* it failed and the
 * console is the only place that says *why*.
 *
 * TURNING IT BACK ON IN PRODUCTION
 * --------------------------------
 * In the browser console of the deployed app:
 *
 *     localStorage.setItem('ycos.debug', '1'); location.reload();
 *
 * and to stop again:
 *
 *     localStorage.removeItem('ycos.debug'); location.reload();
 *
 * `window.ycosDebug(true)` does the same thing and is easier to dictate over a support chat. The flag
 * is read once per page load, so both forms need the reload — that keeps the check off the hot path
 * of a logger that is called from inside polling loops.
 *
 * WHAT THIS CANNOT SILENCE
 * ------------------------
 * `net::ERR_CONNECTION_CLOSED`, `Failed to load resource: 429`, CORS rejections and similar are
 * emitted by the browser's network stack, not by JavaScript. There is no API — not overriding
 * `console.error`, not catching the rejected promise, not `preventDefault()` on any event — that
 * removes them, because they are logged before the fetch promise ever rejects. The only real fix for
 * those is to stop making requests that fail: see the circuit breaker in lib/balances/rpc.ts and the
 * endpoint ordering in lib/balances/endpoints.ts.
 */

/** The localStorage key a developer sets to re-enable logging on a production build. */
const DEBUG_KEY = 'ycos.debug';

/**
 * Whether verbose logging is on for this page load.
 *
 * Development is verbose by default — that is the whole point of a development build. In production
 * it takes an explicit opt-in, either the localStorage flag (no rebuild, works on the deployed site)
 * or one of the legacy `NEXT_PUBLIC_DEBUG_*` build flags, which are honoured so that existing
 * deployment configs and anyone's muscle memory keep working.
 *
 * Resolved once at module load rather than per call. `debug()` runs inside an 80ms MPC polling loop
 * and on every balance sweep; a localStorage read there is a synchronous main-thread hit for a value
 * that cannot meaningfully change mid-session.
 */
function resolveEnabled(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  if (
    process.env.NEXT_PUBLIC_DEBUG_SIGNING === '1' ||
    process.env.NEXT_PUBLIC_DEBUG_BALANCES === '1'
  ) {
    return true;
  }
  // Server-rendered passes have no localStorage, and server logs are not the user's console anyway.
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(DEBUG_KEY) === '1';
  } catch {
    // Private browsing and some embedded webviews throw on localStorage access. Treat that as off
    // rather than letting a logging helper take down the page that imported it.
    return false;
  }
}

let enabled = resolveEnabled();

/**
 * Is verbose logging on?
 *
 * Exported so call sites can skip *building* an expensive message, not just printing it — the phase
 * table in core/timings.ts and the `JSON.stringify` of a whole transaction are the cases that matter.
 */
export function isDebugEnabled(): boolean {
  return enabled;
}

/**
 * Flip the flag for the next page load.
 *
 * Also applied to the current session so a developer typing this in the console sees it take effect
 * immediately, without having to reload to confirm they typed it correctly.
 */
export function setDebugEnabled(on: boolean): void {
  enabled = on || process.env.NODE_ENV !== 'production';
  if (typeof window === 'undefined') return;
  try {
    if (on) window.localStorage.setItem(DEBUG_KEY, '1');
    else window.localStorage.removeItem(DEBUG_KEY);
  } catch {
    /* Nothing to persist to; the in-memory flag above still applies for this session. */
  }
}

/**
 * Verbose narration. Silent unless logging is on.
 *
 * `console.log` rather than `console.debug` on purpose: Chrome hides `debug` behind a "Verbose" level
 * that is off by default, so a developer who went to the trouble of enabling the flag would see
 * nothing and reasonably conclude the flag was broken.
 */
export function debug(...args: unknown[]): void {
  if (enabled) console.log(...args);
}

/**
 * An anticipated, already-handled condition. Silent unless logging is on.
 *
 * If reaching this line means the wallet is about to show the user something wrong, it is not a
 * `warn` — promote it to `error`.
 */
export function warn(...args: unknown[]): void {
  if (enabled) console.warn(...args);
}

/**
 * An unexpected fault. **Always printed, production included.**
 *
 * Reserve it for outcomes the code has no answer for. Everything routine — a rotating endpoint, a
 * missing account, a retry that worked — belongs in `warn`, or the signal drowns in the noise again.
 */
export function error(...args: unknown[]): void {
  console.error(...args);
}

/**
 * Log at most once per `windowMs` for a given key, and only when logging is on.
 *
 * Repetition is its own kind of noise: the balance layer retries the same endpoint across every
 * sweep, so an unconditional line prints the identical text four times a refresh and hides whatever
 * came before it. Keyed by call site rather than by message so a counter or a duration embedded in
 * the text does not defeat the deduplication.
 */
const lastLogged = new Map<string, number>();

export function throttled(
  key: string,
  message: string,
  options: { level?: 'debug' | 'warn'; windowMs?: number } = {}
): void {
  if (!enabled) return;
  const windowMs = options.windowMs ?? 60_000;
  const now = Date.now();
  if ((lastLogged.get(key) ?? 0) + windowMs > now) return;
  lastLogged.set(key, now);
  if (options.level === 'debug') console.log(message);
  else console.warn(message);
}

/** Namespaced form, for call sites that read better as `log.debug(...)`. */
export const log = { debug, warn, error, throttled, isDebugEnabled, setDebugEnabled };

/**
 * Expose the switch on `window` so it can be dictated over a support conversation.
 *
 * Attached at import time from the client bundle. Guarded on `window` because this module is also
 * pulled into server components through the shared chain code.
 */
if (typeof window !== 'undefined') {
  (window as unknown as { ycosDebug?: (on?: boolean) => string }).ycosDebug = (on = true) => {
    setDebugEnabled(on);
    return on
      ? `ycos logging ON — reload for the full trace from page load.`
      : `ycos logging OFF — reload to clear it completely.`;
  };
}
