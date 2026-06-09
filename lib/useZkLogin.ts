"use client";

/**
 * Client hook — owns the BROWSER half of zkLogin: the ephemeral key and the
 * sign-in / sign-out lifecycle.
 *
 * The ephemeral key lives in sessionStorage (cleared when the tab closes). That's the secret that
 * signs transactions; it never goes to the server. The server holds the JWT/salt/address in an
 * httpOnly cookie. To sign a transaction, see `lib/zklogin/execute.ts::zkLoginSignAndExecute`.
 */

import { useCallback, useEffect, useState } from "react";
import { createEphemeralSession, type EphemeralSession } from "@/lib/zklogin/zklogin";

const EPH_KEY = "zk.ephemeral";

function saveEphemeral(s: EphemeralSession) {
  sessionStorage.setItem(EPH_KEY, JSON.stringify(s));
}

export interface ZkUser {
  address: string;
  email: string | null;
  name: string | null;
}

export function useZkLogin() {
  const [user, setUser] = useState<ZkUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/zklogin/me").then((r) => r.json());
    setUser(r.signedIn ? { address: r.address, email: r.email, name: r.name } : null);
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

  const signOut = useCallback(async () => {
    sessionStorage.removeItem(EPH_KEY);
    await fetch("/api/zklogin/logout", { method: "POST" }).catch(() => {});
    setUser(null);
  }, []);

  return { user, loading, signIn, signOut, refresh };
}
