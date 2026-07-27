'use client';

/**
 * Whether this account has already created its wallets.
 *
 * WHY THIS IS REMEMBERED RATHER THAN JUST OBSERVED
 * -----------------------------------------------
 * Once wallets exist, "Create" is a step the user has finished, so it should not sit in the navigation
 * offering to do it again. The dashboard already discovers the wallets — but discovery is a couple of
 * RPC round-trips, so for the first second or two of every page load the answer is unknown. Deriving
 * the tab purely from live discovery therefore showed "Create", then removed it mid-glance, on every
 * single load.
 *
 * So the answer is cached per address. It is a UI hint and nothing more: creation is still gated by the
 * on-chain check in `CreateView`, which enforces at most one dWallet per curve regardless of what this
 * says. A wrong value here can only ever show or hide a tab.
 *
 * Keyed by address because one browser can be used by more than one Google account, and cleared on
 * sign-out so the next user does not inherit a claim about wallets they do not own.
 */

const KEY = 'ycos.walletsExist.v1';

type Store = Record<string, true>;

function read(): Store {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Store;
  } catch {
    return {};
  }
}

/**
 * Has this address created its wallets, as far as we last saw?
 *
 * Only ever `true` from a positive observation. Absence means "not known yet", not "no" — which is why
 * the caller should treat it as a hint and let discovery correct it.
 */
export function knownToHaveWallets(address: string | undefined): boolean {
  if (!address) return false;
  return read()[address] === true;
}

/** Record that this address has wallets. Idempotent. */
export function rememberHasWallets(address: string | undefined): void {
  if (!address || typeof window === 'undefined') return;
  const store = read();
  if (store[address]) return;
  store[address] = true;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Private mode or a full quota: the tab just flashes on load, which is what happened before.
  }
}

/** Forget everything, on sign-out. */
export function clearWalletsExist(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * Any address this browser has seen wallets for, or undefined.
 *
 * Used to choose the opening tab before the session has resolved — at that moment the signed-in address
 * is not known yet, but "has anyone finished setup in this browser" is enough to decide whether to open
 * on the funding screen. Sign-out clears the store, so a stale answer cannot outlive an account.
 */
export function anyRememberedAddress(): string | undefined {
  return Object.keys(read())[0];
}
