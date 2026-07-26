"use client";

/**
 * Client hook — owns the BROWSER half of zkLogin: the ephemeral key and the
 * sign-in / sign-out lifecycle.
 *
 * The ephemeral key lives in sessionStorage (cleared when the tab closes). That's the secret that
 * signs transactions; it never goes to the server. The server holds the JWT/salt/address in an
 * httpOnly cookie. To sign a transaction, see `lib/zklogin/execute.ts::zkLoginSignAndExecute`.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createEphemeralSession } from "@/lib/zklogin/zklogin";
import { clearEphemeral, loadEphemeral, saveEphemeral } from "@/lib/zklogin/ephemeralStore";
import { hasExpired, msUntil } from "@/lib/zklogin/duration";
import { clearShareEncryptionKeys } from "@/lib/ika/shareKeys";
import { resetIkaClient } from "@/lib/ika/ikaClient";
import { clearPresignPool } from "@/lib/ika/presignPool";
import { clearDWalletMeta } from "@/lib/dwallet/dwalletMeta";
import { clearBalances } from "@/lib/balances/store";
import { clearUserShares } from "@/lib/ika/userShare";
import { clearHistory } from "@/lib/history/store";
import { clearSigningWarmup } from "@/lib/ika/warmSigning";

export interface ZkUser {
  address: string;
  email: string | null;
  name: string | null;
  /** Epoch ms when this session ends and the user is signed out. */
  expiresAt: number;
}

/** Marker read once on the homepage to explain why the user is suddenly signed out. */
const EXPIRED_FLAG = "zk.sessionExpired";

/** Whether the last sign-out was caused by expiry. Reading it clears it. */
export function consumeExpiredNotice(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const had = window.sessionStorage.getItem(EXPIRED_FLAG) === "1";
    if (had) window.sessionStorage.removeItem(EXPIRED_FLAG);
    return had;
  } catch {
    return false;
  }
}

function useZkLoginState(initiallySignedIn: boolean) {
  const [user, setUser] = useState<ZkUser | null>(null);
  /**
   * Start as "loading" only when the user could plausibly be signed in.
   *
   * A session needs BOTH halves — the server cookie and the browser's ephemeral key — so a visitor with
   * neither is provably signed out and should never wait on /api/zklogin/me to be told so. That is why this
   * is seeded rather than simply `true`: a first-time visitor renders the landing page immediately.
   *
   * The seed comes from the SERVER's view of the cookie, and deliberately not from `loadEphemeral()`.
   * Branching on `typeof window` here produced a real hydration mismatch — the server rendered the loading
   * placeholder while the browser's first render, seeing no local key, rendered the sign-in button, so React
   * discarded and re-rendered the tree. The server cannot see sessionStorage, so the only value both sides
   * can agree on at first render is the one the server sent. The missing local key is then caught a moment
   * later by `refresh`, which treats a cookie without a key as signed out.
   */
  const [loading, setLoading] = useState(initiallySignedIn);

  const refresh = useCallback(async () => {
    /**
     * Yield before touching state, for the same reason as the dashboard's `load`: this is called from an
     * effect on mount, and the no-key path below would otherwise setState synchronously inside it and
     * cascade a second render of everything under the provider.
     */
    await Promise.resolve();
    // Same short-circuit: no local key means no usable session, so skip the request entirely.
    if (loadEphemeral() === null) {
      setUser(null);
      setLoading(false);
      return;
    }
    const r = await fetch("/api/zklogin/me").then((r) => r.json());
    /**
     * Both halves must be present.
     *
     * The server cookie and the browser's ephemeral key expire independently, and a user with one but
     * not the other is not usable: the page would show them as signed in while every transaction failed.
     * Treating that as signed-out sends them back through login, which is the only thing that fixes it.
     */
    const keyAlive = loadEphemeral() !== null;
    setUser(
      r.signedIn && keyAlive && !hasExpired(r.expiresAt)
        ? { address: r.address, email: r.email, name: r.name, expiresAt: r.expiresAt }
        : null
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    // See the note on `load` in AppShell: `refresh` yields before touching state, and the rule matches the
    // call site rather than following the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  /** Create the ephemeral session, then bounce to Google. */
  const signIn = useCallback(async () => {
    const { epoch } = await fetch("/api/zklogin/epoch").then((r) => r.json());
    const eph = createEphemeralSession(Number(epoch));
    saveEphemeral(eph);
    window.location.href = `/api/zklogin/login?nonce=${encodeURIComponent(eph.nonce)}`;
  }, []);

  const signOut = useCallback(async (options: { expired?: boolean } = {}) => {
    clearEphemeral();
    // Drop cached share-encryption keys too, so a shared machine doesn't carry them to the next user.
    clearShareEncryptionKeys();
    resetIkaClient();
    clearPresignPool();
    clearDWalletMeta();
    // Balances are per-address; leaving them would show one user's funds to the next.
    clearBalances();
    // The decrypted key shares are the actual signing material — drop them first, not eventually.
    clearUserShares();
    // History is per account and sits in localStorage, so it would otherwise greet the next user.
    clearHistory();
    clearSigningWarmup();
    await fetch("/api/zklogin/logout", { method: "POST" }).catch(() => {});
    setUser(null);

    if (options.expired) {
      try {
        sessionStorage.setItem(EXPIRED_FLAG, "1");
      } catch {
        /* storage unavailable — the user just gets no explanation */
      }
      // Back to the homepage to sign in again. A full navigation rather than a state change, so every
      // view unmounts and no stale in-memory data survives into the next session.
      window.location.href = "/";
    }
  }, []);

  /**
   * Sign the user out the moment the session ends.
   *
   * A timer alone is not enough: browsers throttle and suspend timers in background tabs, and a laptop
   * that sleeps for a day would wake with the timer still pending. So expiry is also checked whenever
   * the tab becomes visible or regains focus, which covers exactly those cases.
   */
  const expiresAt = user?.expiresAt;

  useEffect(() => {
    if (!expiresAt) return;

    // `signOut` is a stable useCallback, so it can be depended on directly. It used to be held in a ref that
    // was reassigned during render — a ref write in the render phase, which React does not allow and which
    // bought nothing over depending on a value that never changes.
    const expireNow = () => void signOut({ expired: true });
    if (hasExpired(expiresAt)) {
      expireNow();
      return;
    }

    // setTimeout saturates above ~24.9 days; a 48h session is far inside that, so one timer is fine.
    const timer = setTimeout(expireNow, msUntil(expiresAt));
    const check = () => {
      if (hasExpired(expiresAt) || loadEphemeral() === null) expireNow();
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [expiresAt, signOut]);

  return useMemo(
    () => ({ user, loading, signIn, signOut, refresh }),
    [user, loading, signIn, signOut, refresh]
  );
}

type ZkLoginValue = ReturnType<typeof useZkLoginState>;

const ZkLoginContext = createContext<ZkLoginValue | null>(null);

/**
 * Owns the single zkLogin session for the app.
 *
 * One instance, not one per consumer. Each `useZkLoginState` runs its own `/api/zklogin/me` request and its
 * own expiry timer, so two components calling it independently meant the session was fetched twice and, at
 * the moment it expired, signed out twice — two logout requests racing one redirect. It also gave the two
 * copies separate `loading` states that could disagree on screen.
 *
 * `initiallySignedIn` is the server's read of the session cookie. It is a rendering hint only; every API
 * route still opens and validates the sealed cookie itself.
 */
export function ZkLoginProvider({
  initiallySignedIn,
  children,
}: {
  initiallySignedIn: boolean;
  children: React.ReactNode;
}) {
  const value = useZkLoginState(initiallySignedIn);
  return <ZkLoginContext.Provider value={value}>{children}</ZkLoginContext.Provider>;
}

/** The shared zkLogin session. Must be rendered under `ZkLoginProvider`. */
export function useZkLogin(): ZkLoginValue {
  const value = useContext(ZkLoginContext);
  if (!value) throw new Error("useZkLogin must be used within <ZkLoginProvider>");
  return value;
}
