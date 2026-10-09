'use client';

/**
 * The school's texts (RESERVATIONS_REWORK.md §3.8): each in English and Arabic, with the variables
 * a message fills per recipient. The reminders' own texts are here too; a text a reminder rule
 * sends cannot be switched off until the rule changes. The admin edits; finance reads.
 */

import { useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, MESSAGE_VARIABLES, MESSAGE_VARIABLE_LABELS } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { INPUT_CLASS, TEXTAREA_CLASS } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';
import { fetchTemplates, TEMPLATES_KEY, type TemplateRow } from './messages-shared';

type Draft = { name: string; titleEn: string; bodyEn: string; titleAr: string; bodyAr: string; active: boolean; reason: string };
const EMPTY: Draft = { name: '', titleEn: '', bodyEn: '', titleAr: '', bodyAr: '', active: true, reason: '' };

export function Templates({ admin }: { admin: boolean }): React.JSX.Element {
  const list = useQuery({ queryKey: TEMPLATES_KEY, queryFn: fetchTemplates });
  const [editing, setEditing] = useState<TemplateRow | 'new' | null>(null);
  if (list.isLoading) return <LoadingState />;
  if (list.isError || !list.data) return <ErrorState onRetry={() => list.refetch()} />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        <span>Variables:</span>{' '}
        {MESSAGE_VARIABLES.map((v, i) => <span key={v}>{i > 0 && ' · '}<span data-i18n-skip="true" className="font-mono">{`{${v}}`}</span> <span>{MESSAGE_VARIABLE_LABELS[v]}</span></span>)}
      </p>
      {admin && editing === null && <Button size="sm" onClick={() => setEditing('new')}>New text</Button>}
      {editing && <TemplateForm row={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      <div className="grid gap-4 lg:grid-cols-2">
        {list.data.map((t) => (
          <article key={t.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-foreground">{t.name}</h3>
              <div className="flex gap-1">
                {t.key && <Badge tone="info">Reminder text</Badge>}
                <Badge tone={t.active ? 'success' : 'neutral'}>{t.active ? 'On' : 'Off'}</Badge>
              </div>
            </div>
            <div className="mt-2 space-y-2 text-sm" data-i18n-skip="true">
              <div><p className="font-medium text-foreground">{t.titleEn}</p><p className="text-muted-foreground">{t.bodyEn}</p></div>
              <div dir="rtl"><p className="font-medium text-foreground">{t.titleAr}</p><p className="text-muted-foreground">{t.bodyAr}</p></div>
            </div>
            {admin && <Button size="sm" variant="outline" className="mt-3" onClick={() => setEditing(t)}>Change</Button>}
          </article>
        ))}
      </div>
    </div>
  );
}

function TemplateForm({ row, onDone }: { row: TemplateRow | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [d, setD] = useState<Draft>(row ? { name: row.name, titleEn: row.titleEn, bodyEn: row.bodyEn, titleAr: row.titleAr, bodyAr: row.bodyAr, active: row.active, reason: '' } : EMPTY);
  const save = useMutation({
    mutationFn: () => row
      ? apiResponse(api.v1.messages.templates[':id'].$put({ param: { id: row.id }, json: d }))
      : apiResponse(api.v1.messages.templates.$post({ json: d })),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY }); onDone(); },
  });
  const field = (k: keyof Draft, label: string, area = false, rtl = false) => (
    <label className="block space-y-1 text-sm" dir={rtl ? 'rtl' : undefined}>
      <span className="font-medium text-foreground">{label}</span>
      {area
        ? <textarea className={TEXTAREA_CLASS} rows={4} value={d[k] as string} onChange={(e) => setD({ ...d, [k]: e.target.value })} />
        : <input className={INPUT_CLASS} value={d[k] as string} onChange={(e) => setD({ ...d, [k]: e.target.value })} />}
    </label>
  );
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm" aria-label={row ? 'Change the text' : 'New text'}>
      {field('name', 'Name')}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-3">{field('titleEn', 'Title (English)')}{field('bodyEn', 'Message (English)', true)}</div>
        <div className="space-y-3">{field('titleAr', 'Title (Arabic)', false, true)}{field('bodyAr', 'Message (Arabic)', true, true)}</div>
      </div>
      <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} /> <span>On</span></label>
      {field('reason', 'Reason')}
      {save.isError && <Notice tone="danger">{(save.error as Error).message}</Notice>}
      <div className="flex gap-2">
        <Button size="sm" disabled={save.isPending || d.reason.trim().length < 3} onClick={() => save.mutate()}>Save</Button>
        <Button size="sm" variant="outline" onClick={onDone}>Back</Button>
      </div>
    </section>
  );
}
