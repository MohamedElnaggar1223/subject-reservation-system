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
  /** A question the action must also answer; confirm stays disabled until one option is picked. */
  choice?: { legend: string; options: { value: string; label: string; hint?: string }[] };
  /** One-line values the action also needs (e.g. a transfer reference and amount); each is required. */
  fields?: { label: string; placeholder?: string; minLength?: number; initial?: string; inputMode?: 'text' | 'decimal'; mono?: boolean }[];
  onConfirm: (reason: string, choice?: string, fieldValues?: string[]) => void;
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
  choice,
  fields = [],
  onConfirm,
  onClose,
}: ReasonModalProps) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [fieldValues, setFieldValues] = useState<string[]>(() => fields.map((f) => f.initial ?? ''));
  const fieldMissing = fields.some((f, i) => (fieldValues[i] ?? '').trim().length < (f.minLength ?? 1));
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

        {choice && (
          <fieldset className="mb-4">
            <legend className="mb-2 text-sm font-medium text-foreground">{choice.legend}</legend>
            <div className="space-y-2">
              {choice.options.map((o) => (
                <label
                  key={o.value}
                  className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-2 text-sm ${
                    picked === o.value ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <input
                    type="radio"
                    name="reason-modal-choice"
                    value={o.value}
                    checked={picked === o.value}
                    onChange={() => setPicked(o.value)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-foreground">{o.label}</span>
                    {o.hint && <span className="block text-xs text-muted-foreground">{o.hint}</span>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {fields.map((f, i) => (
          <div key={f.label} className="mb-4">
            <label className="mb-1 block text-sm font-medium text-foreground" htmlFor={`reason-modal-field-${i}`}>
              {f.label}
            </label>
            <input
              id={`reason-modal-field-${i}`}
              type="text"
              inputMode={f.inputMode ?? 'text'}
              value={fieldValues[i] ?? ''}
              onChange={(e) => setFieldValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder={f.placeholder}
              className={`w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary ${f.mono ? 'font-mono' : ''}`}
            />
          </div>
        ))}

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
            disabled={isPending || tooShort || (!!choice && !picked) || fieldMissing}
            onClick={() => onConfirm(reason.trim(), picked, fields.length ? fieldValues.map((v) => v.trim()) : undefined)}
          >
            {isPending ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
