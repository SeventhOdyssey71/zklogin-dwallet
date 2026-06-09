'use client';

import { useState } from 'react';
import { useZkLogin } from '@/lib/useZkLogin';

/**
 * zkLogin connect control — "Sign in with Google" instead of a browser wallet.
 * The user's Sui address is derived from their Google account (no seed phrase).
 */
export function ConnectWallet() {
  const { user, loading, signIn, signOut } = useZkLogin();
  const [copied, setCopied] = useState(false);

  if (loading) {
    return <div className="text-sm text-[var(--muted)]">…</div>;
  }

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            navigator.clipboard.writeText(user.address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex items-center gap-2 px-3 py-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-sm whitespace-nowrap hover:border-[var(--foreground)]/40 transition-colors"
          title={user.email ?? user.address}
        >
          <span className="w-2 h-2 rounded-full bg-[var(--foreground)] shrink-0" />
          <span className="tabular-nums">
            {copied ? 'copied' : `${user.address.slice(0, 6)}…${user.address.slice(-4)}`}
          </span>
        </button>
        <button
          onClick={() => signOut()}
          className="px-3 py-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--muted)] whitespace-nowrap hover:text-[var(--foreground)] transition-colors"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => signIn()}
      className="px-4 py-2 rounded-[10px] bg-[var(--foreground)] text-black font-semibold text-sm whitespace-nowrap hover:brightness-90 transition"
    >
      Sign in with Google
    </button>
  );
}
