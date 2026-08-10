'use client';

/**
 * ReasonModal — collects a mandatory, audited reason for a destructive
 * staff action.
 *
 * Replaces window.prompt(), which is unstyled, untranslatable, silently
 * blocked in kiosk/embedded browsers, and cannot validate input — all
 * unacceptable for actions that write an audit record (payment
 * reversal, writing a receipt off as lost).
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '~/components/ui/button';

export type ReasonModalProps = {
  title: string;
  /** Explains the consequence — shown above the input */
  description: string;
  label?: string;
  placeholder?: string;
  confirmLabel: string;
  destructive?: boolean;
  isPending?: boolean;
  error?: string;
  minLength?: number;
  onConfirm: (reason: string) => void;
  onClose: () => void;
};

export function ReasonModal({
  title,
  description,
  label = 'Reason',
  placeholder,
  confirmLabel,
  destructive = false,
  isPending = false,
  error,
  minLength = 3,
  onConfirm,
  onClose,
}: ReasonModalProps) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focus the input on open; Escape closes (parity with a native dialog)
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, isPending]);

  const tooShort = reason.trim().length < minLength;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reason-modal-title"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
        <h2 id="reason-modal-title" className="mb-1 font-display text-lg font-bold text-foreground">
          {title}
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">{description}</p>

        <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="reason-modal-input">
          {label}
        </label>
        <textarea
          id="reason-modal-input"
          ref={inputRef}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={placeholder}
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {touched && tooShort && (
          <p className="mt-1 text-xs text-destructive">
            Please write a short reason — it is stored in the audit trail.
          </p>
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

        <div className="mt-4 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            className="flex-1"
            disabled={isPending || tooShort}
            onClick={() => onConfirm(reason.trim())}
          >
            {isPending ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
