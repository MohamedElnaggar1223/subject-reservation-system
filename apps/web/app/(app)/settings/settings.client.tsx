'use client';

/**
 * School Settings (F0a)
 *
 * Today the school changes a rule like "may graduates retake?" by asking a
 * developer. Here each rule is one card in plain words: what it does, what
 * it is set to, who last changed it, and — for a role the rule names — a
 * change with a reason, recorded in the audit log. Roles the rule does not
 * name see it read-only, with who can change it.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, ROLE_LABELS, WEEKDAY_LABELS, type Role } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { useI18n } from '~/lib/i18n';

// Typed by the API, never by hand (CLAUDE.md: Hono RPC everywhere).
const fetchSettings = () => apiResponse(api.v1.settings.$get());
type Setting = Awaited<ReturnType<typeof fetchSettings>>[number];

const GROUPS: { id: string; title: string; hint: string }[] = [
  { id: 'eligibility', title: 'Who may register', hint: 'Which students may register for which exam series.' },
  { id: 'school_fee', title: 'School fee', hint: 'When the annual school fee gates registration.' },
  { id: 'calendar', title: 'Calendar', hint: 'The school week the calendar and the day’s lists build on.' },
];

/** The value as a person reads it. */
function describeValue(s: Setting, value: unknown): string {
  if (s.input === 'boolean') return value === true ? 'On' : 'Off';
  if (s.input === 'choice') return s.choices.find((c) => c.value === value)?.label ?? String(value);
  if (s.input === 'weekdays' && Array.isArray(value)) {
    return [...(value as number[])].sort((a, b) => a - b).map((d) => WEEKDAY_LABELS[d] ?? String(d)).join(', ');
  }
  return JSON.stringify(value);
}

/** A moment in the page's language (Arabic month names with Latin digits, as the rest of the app writes numbers). */
function formatWhen(iso: string | Date, language: string): string {
  return new Date(iso).toLocaleString(language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function SettingsClient(): React.JSX.Element {
  const { data: settings = [], isLoading, isError, error } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });
  const [saved, setSaved] = useState<{ label: string; value: string } | null>(null);

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto animate-fade-up">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">School settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Rules the school can change without a developer. Each change needs a reason and is recorded in the audit log.
        </p>
      </div>

      {saved && (
        <Notice tone="success" className="mb-6">
          <div className="flex items-start justify-between gap-3">
            <span><span>Saved:</span> <span>{saved.label}</span> → <span>{saved.value}</span></span>
            <button type="button" className="text-xs underline hover:no-underline" onClick={() => setSaved(null)}>Dismiss</button>
          </div>
        </Notice>
      )}

      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
        </div>
      ) : isError ? (
        <Notice tone="danger" title="Could not load the settings">{error instanceof Error ? error.message : null}</Notice>
      ) : (
        <div className="space-y-8">
          {GROUPS.map((g) => {
            const inGroup = settings.filter((s) => s.group === g.id);
            if (inGroup.length === 0) return null;
            return (
              <section key={g.id} aria-labelledby={`group-${g.id}`}>
                <h2 id={`group-${g.id}`} className="font-semibold text-foreground font-display">{g.title}</h2>
                <p className="text-xs text-muted-foreground mb-3">{g.hint}</p>
                <div className="space-y-3">
                  {inGroup.map((s) => (
                    <SettingCard key={s.key} setting={s} onSaved={setSaved} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SettingCard({ setting: s, onSaved }: { setting: Setting; onSaved: (saved: { label: string; value: string }) => void }): React.JSX.Element {
  const queryClient = useQueryClient();
  const { language } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<unknown>(s.value);
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      apiResponse(api.v1.settings[':key'].$put({ param: { key: s.key }, json: { value: draft, reason: reason.trim() } })),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setEditing(false);
      setFormError('');
      onSaved({ label: updated.label, value: describeValue(updated, updated.value) });
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const whoMayChange = s.editableBy.map((r) => ROLE_LABELS[r as Role] ?? r);
  const unchanged = JSON.stringify(draft) === JSON.stringify(s.value);

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-foreground">{s.label}</h3>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{s.description}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={s.input === 'boolean' ? (s.value === true ? 'success' : 'neutral') : 'info'}>
            {describeValue(s, s.value)}
          </Badge>
          {s.isDefault && <span className="text-xs text-muted-foreground">School default</span>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {s.updatedAt
            ? <><span>Last changed</span> <span>{formatWhen(s.updatedAt, language)}</span>{s.updatedBy && <> · <span>{s.updatedBy}</span></>}</>
            : <span>Never changed</span>}
          {' · '}
          <span>Who may change it:</span>{' '}
          {whoMayChange.map((label, i) => (
            <span key={label}>{i > 0 && ', '}<span>{label}</span></span>
          ))}
        </span>
        {s.canEdit && !editing && (
          <Button size="sm" variant="outline" onClick={() => { setDraft(s.value); setReason(''); setFormError(''); setEditing(true); }}>
            Change
          </Button>
        )}
      </div>

      {editing && (
        <form
          className="mt-4 space-y-3 border-t border-border pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            setFormError('');
            if (unchanged) { setFormError('Pick a different value first.'); return; }
            if (reason.trim().length < 3) { setFormError('A reason is required.'); return; }
            mutation.mutate();
          }}
        >
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-foreground">New value</legend>
            {s.input === 'boolean' && (
              <div className="flex flex-wrap gap-3">
                {[true, false].map((v) => (
                  <label key={String(v)} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                    <input type="radio" name={`${s.key}-value`} checked={draft === v} onChange={() => setDraft(v)} />
                    <span>{v ? 'On' : 'Off'}</span>
                  </label>
                ))}
              </div>
            )}
            {s.input === 'choice' && (
              <div className="flex flex-col gap-2">
                {s.choices.map((c) => (
                  <label key={c.value} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                    <input type="radio" name={`${s.key}-value`} checked={draft === c.value} onChange={() => setDraft(c.value)} />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            )}
            {s.input === 'weekdays' && Array.isArray(draft) && (
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_LABELS.map((label, day) => {
                  const days = draft as number[];
                  const on = days.includes(day);
                  return (
                    <label key={label} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setDraft(on ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b))}
                      />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>

          {s.key === 'eligibility.graduateRetakes' && s.value === true && draft === false && (
            <Notice tone="warning">
              Turning this off expires the waiting registrations graduates already made for the October, November and January series; their open checkouts are closed, any wallet money returned, and families told.
            </Notice>
          )}

          <div>
            <label htmlFor={`${s.key}-reason`} className="mb-1 block text-sm font-medium text-foreground">
              Reason <span className="text-destructive">*</span>
            </label>
            <textarea
              id={`${s.key}-reason`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Agreed at the staff meeting on 3 October"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
            <p className="mt-1 text-xs text-muted-foreground">This reason is recorded in the audit log.</p>
          </div>

          {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => { setEditing(false); setFormError(''); }}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving...' : 'Save change'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
