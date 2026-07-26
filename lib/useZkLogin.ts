"use client";

/**
 * Client hook — owns the BROWSER half of zkLogin: the ephemeral key and the
 * sign-in / sign-out lifecycle.
 *
 * The ephemeral key lives in sessionStorage (cleared when the tab closes). That's the secret that
 * signs transactions; it never goes to the server. The server holds the JWT/salt/address in an
 * httpOnly cookie. To sign a transaction, see `lib/zklogin/execute.ts::zkLoginSignAndExecute`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
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

export function useZkLogin() {
  const [user, setUser] = useState<ZkUser | null>(null);
  /**
   * Start as "loading" only when the user could plausibly be signed in.
   *
   * A session needs BOTH halves — the server cookie and the browser's ephemeral key — so the absence of a
   * local key is proof of signed-out without asking the server. Waiting on /api/zklogin/me regardless meant
   * every first-time visitor stared at a spinner before the landing page appeared, for a question already
   * answered locally.
   */
  const [loading, setLoading] = useState(() =>
    typeof window === "undefined" ? true : loadEphemeral() !== null
  );

  const refresh = useCallback(async () => {
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
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;

  useEffect(() => {
    if (!expiresAt) return;

    const expireNow = () => void signOutRef.current({ expired: true });
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
  }, [expiresAt]);

  return { user, loading, signIn, signOut, refresh };
}
