'use client';

/**
 * Shared UI primitives.
 *
 * These exist because the same twelve-class Tailwind strings were being retyped at every call site —
 * so the primary button had four slightly different paddings, two different radii, and inconsistent
 * disabled states depending on which view you were looking at. Consolidating them means a visual
 * change happens once, and every button is keyboard-accessible by construction rather than by luck.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Check, Copy, ExternalLink, Loader2, X } from 'lucide-react';

/* --------------------------------- Button --------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--foreground)] text-black font-bold hover:brightness-90 disabled:hover:brightness-100',
  secondary:
    'border border-[var(--border)] text-[var(--foreground)] font-semibold hover:bg-[var(--surface-2)] hover:border-[var(--border-strong)]',
  ghost: 'text-[var(--muted)] hover:text-[var(--foreground)]',
  danger:
    'border border-[var(--danger-border)] text-[var(--danger)] font-semibold hover:bg-[var(--danger-surface)]',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-[var(--radius-xs)]',
  md: 'px-4 py-2.5 text-sm rounded-[var(--radius-sm)]',
  lg: 'px-6 py-3 text-sm rounded-[12px]',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  className = '',
  disabled,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      // `aria-busy` tells a screen reader the control is working; a spinner alone is invisible to it.
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap transition disabled:opacity-40 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/* ---------------------------------- Notes --------------------------------- */

/**
 * An error, styled as one.
 *
 * `role="alert"` matters more than the colour: it makes a screen reader announce the failure instead of
 * leaving it as text that silently appeared somewhere on the page. The raw text stays behind a
 * disclosure so an unexpected error is still reportable without dominating the dialog.
 */
export function ErrorNote({
  message,
  action,
  raw,
}: {
  message: string;
  action?: string;
  raw?: string;
}) {
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-sm)] border border-[var(--danger-border)] bg-[var(--danger-surface)] p-3"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--danger)]" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-xs text-[var(--foreground)] break-words">{message}</p>
          {action && <p className="text-xs text-[var(--muted)] break-words">{action}</p>}
          {raw && raw !== message && (
            <details className="text-[11px] text-[var(--muted-2)]">
              <summary className="hover:text-[var(--muted)]">Technical details</summary>
              <p className="mt-1 break-words font-normal">{raw}</p>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

/** A quiet inline status line. `aria-live` announces progress without stealing focus. */
export function StatusNote({ children }: { children: ReactNode }) {
  return (
    <div
      aria-live="polite"
      className="flex items-start gap-2 text-xs text-[var(--muted)] break-words"
    >
      <Loader2 className="w-3.5 h-3.5 animate-spin mt-0.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

/* --------------------------------- Copyable -------------------------------- */

/**
 * Copy-to-clipboard, with the failure path handled.
 *
 * `navigator.clipboard` rejects outright in a non-secure context and when permission is denied, and the
 * old call sites ignored the returned promise — so a failed copy showed a "copied" tick and the user
 * pasted whatever was there before. Here a failure is reported.
 */
function useCopy(value: string) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 1600);
  };
  return { state, copy };
}

/** Truncate a long identifier in the middle, keeping both ends recognisable. */
export function truncate(value: string, lead = 10, tail = 8): string {
  return value.length <= lead + tail + 1 ? value : `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

/**
 * A labelled, copyable value.
 *
 * Long values are truncated by default: a full Cardano address is 103 characters and wrapping it across
 * four lines made every card taller than its actual content. The full value is always in the `title`
 * and on the clipboard.
 */
export function CopyField({
  label,
  value,
  full = false,
  href,
}: {
  label?: string;
  value: string;
  /** Show the whole value rather than truncating it. */
  full?: boolean;
  /** Explorer link, shown alongside the copy control. */
  href?: string;
}) {
  const { state, copy } = useCopy(value);
  return (
    <div>
      {label && <div className="mono-label mb-1">{label}</div>}
      <div className="flex items-stretch gap-1.5">
        <button
          onClick={copy}
          title={`${value}\n\nClick to copy`}
          aria-label={`Copy ${label ?? 'value'}: ${value}`}
          className="group flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius-xs)] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--border-strong)] transition text-left"
        >
          <code className={`text-xs flex-1 min-w-0 ${full ? 'break-all' : 'truncate'}`}>
            {full ? value : truncate(value, 8, 6)}
          </code>
          {state === 'copied' ? (
            <Check className="w-3.5 h-3.5 shrink-0 text-[var(--success)]" aria-hidden />
          ) : state === 'failed' ? (
            <X className="w-3.5 h-3.5 shrink-0 text-[var(--danger)]" aria-hidden />
          ) : (
            <Copy
              className="w-3.5 h-3.5 shrink-0 text-[var(--muted)] group-hover:text-[var(--foreground)]"
              aria-hidden
            />
          )}
        </button>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View on block explorer"
            title="View on block explorer"
            className="shrink-0 grid place-items-center px-2.5 rounded-[var(--radius-xs)] bg-[var(--surface-2)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--border-strong)] transition"
          >
            <ExternalLink className="w-3.5 h-3.5" aria-hidden />
          </a>
        )}
      </div>
      <span aria-live="polite" className="sr-only">
        {state === 'copied' ? 'Copied to clipboard' : state === 'failed' ? 'Copy failed' : ''}
      </span>
    </div>
  );
}

/* ---------------------------------- Modal ---------------------------------- */

/**
 * An accessible modal dialog.
 *
 * The previous send dialog was a positioned `div`: no `role`, no `aria-modal`, no Escape key, no focus
 * management, and the page behind it kept scrolling. A keyboard user could tab straight out of it into
 * the page underneath while it was still open, and a screen reader was never told a dialog had appeared.
 *
 * This handles the four things a dialog must do: label itself, trap focus, close on Escape, and restore
 * focus to whatever opened it.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  /** Block Escape and the backdrop while work is in flight, so a send can't be half-abandoned. */
  locked = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  locked?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  // Remember what had focus, move focus into the dialog, and put it back on close.
  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    const firstField = panelRef.current?.querySelector<HTMLElement>(
      'input, textarea, select, button:not([aria-label="Close"])'
    );
    (firstField ?? panelRef.current)?.focus();
    return () => restoreTo.current?.focus?.();
  }, [open]);

  // Escape to close, Tab cycled within the dialog.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !locked) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, locked, onClose]);

  // Stop the page behind the dialog from scrolling.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={locked ? undefined : onClose}
            className="fixed inset-0 bg-black/75 backdrop-blur-sm z-40"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(92vw,28rem)] max-h-[88vh] overflow-y-auto z-50 card p-5 outline-none"
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <h2 id={titleId} className="font-bold text-[15px] leading-tight">
                  {title}
                </h2>
                {subtitle && <div className="mono-label mt-0.5">{subtitle}</div>}
              </div>
              <button
                onClick={onClose}
                disabled={locked}
                aria-label="Close"
                className="shrink-0 -mt-1 -mr-1 p-1.5 rounded-[var(--radius-xs)] text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-2)] transition disabled:opacity-30"
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
            </div>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* -------------------------------- Skeleton -------------------------------- */

/** Placeholder for a value that hasn't loaded. Announced as busy, not as a zero. */
export function Skeleton({ className = 'h-3 w-16' }: { className?: string }) {
  return <span aria-busy="true" aria-label="Loading" className={`skeleton inline-block ${className}`} />;
}
