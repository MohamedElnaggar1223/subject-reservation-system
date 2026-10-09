'use client';

/**
 * A new message (RESERVATIONS_REWORK.md §4.8): the audience — a broadcast (one click on a group
 * such as "Parents of grade 11"), a list the system already holds, or chosen people — resolved as
 * it is picked, with how many people it reaches; a template or written text, its variables offered
 * where the audience can fill them, and a preview of the first recipient's copy; the channels; now,
 * tomorrow at 09:00 or a time. After a send the audience and channels stay, so a second message to
 * the same people is the text and the time (UX_AUDIT §4: today's form reset between the two).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import {
  apiResponse, renderMessage, variablesIn, MESSAGE_VARIABLES, MESSAGE_VARIABLE_LABELS, BATCH_LIST_LABELS, WHO_LABELS, CHARGE_KIND_LABELS,
  type AudienceDefinitionType, type AudienceInputType, type MessageVariable, type AudienceWho, type BatchList, type ChargeKind,
} from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { INPUT_CLASS, TEXTAREA_CLASS } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';
import { InstantText } from '~/app/(app)/exams/exams-shared';
import {
  fetchSavedAudiences, fetchLists, fetchTemplates, resolveAudience, fetchPeople, cairoInstant, tomorrowAtNine, countWords,
  MESSAGES_KEY, TEMPLATES_KEY, ROLE_WORD, type Resolved,
} from './messages-shared';

type Kind = 'broadcast' | 'batch' | 'direct';
type When = 'now' | 'tomorrow' | 'pick';

export function Composer({ admin }: { admin: boolean }): React.JSX.Element {
  const queryClient = useQueryClient();
  const saved = useQuery({ queryKey: [...MESSAGES_KEY, 'audiences'], queryFn: fetchSavedAudiences });
  const templates = useQuery({ queryKey: TEMPLATES_KEY, queryFn: fetchTemplates });

  // ── The audience ──
  const [kind, setKind] = useState<Kind>(admin ? 'broadcast' : 'batch');
  const [savedId, setSavedId] = useState<string | null>(null);
  const [list, setList] = useState<BatchList>('session_unpaid');
  const [sessionId, setSessionId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [groupKey, setGroupKey] = useState('');
  const [offerId, setOfferId] = useState('');
  const [chargeKind, setChargeKind] = useState<ChargeKind>('school_fee_push');
  const [academicYear, setAcademicYear] = useState('');
  const [who, setWho] = useState<AudienceWho>('families');
  const [people, setPeople] = useState<{ id: string; name: string; role: string | null }[]>([]);
  const [contextSession, setContextSession] = useState('');
  const lists = useQuery({ queryKey: [...MESSAGES_KEY, 'lists', sessionId], queryFn: () => fetchLists(sessionId || undefined) });

  const definition = useMemo<AudienceDefinitionType | null>(() => {
    if (kind === 'direct') return people.length ? { kind: 'direct', userIds: people.map((p) => p.id) } : null;
    if (kind === 'broadcast') return null;
    switch (list) {
      case 'session_unpaid': return sessionId ? { kind: 'batch', list, sessionId, include: 'both', filter: 'unpaid', who } : null;
      case 'section': return sectionId ? { kind: 'batch', list, sectionId, who } : null;
      case 'teaching_group': {
        const g = lists.data?.teachingGroups.find((x) => `${x.subjectId}|${x.unitId ?? ''}|${x.teacherId ?? ''}` === groupKey);
        return g ? { kind: 'batch', list, academicYearId: g.academicYearId, subjectId: g.subjectId, unitId: g.unitId, teacherId: g.teacherId, who } : null;
      }
      case 'offer_reservers': return offerId ? { kind: 'batch', list, offerId, lines: 'live', who } : null;
      case 'charge_holders': return { kind: 'batch', list, chargeKind, unpaidOnly: true, ...(chargeKind === 'school_fee_push' && academicYear ? { academicYear } : {}), who };
    }
  }, [kind, list, sessionId, sectionId, groupKey, offerId, chargeKind, academicYear, who, people, lists.data]);
  const audience: AudienceInputType | null = kind === 'broadcast' ? (savedId ? { savedId } : null) : definition ? { definition } : null;
  const audienceKey = JSON.stringify(audience);
  const resolved = useQuery({
    queryKey: [...MESSAGES_KEY, 'resolve', audienceKey, contextSession],
    queryFn: () => resolveAudience(audience!, contextSession || null),
    enabled: !!audience,
  });

  // ── The text ──
  const [templateId, setTemplateId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [withArabic, setWithArabic] = useState(false);
  const [titleAr, setTitleAr] = useState('');
  const [bodyAr, setBodyAr] = useState('');
  const [language, setLanguage] = useState<'both' | 'en' | 'ar'>('both');
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const template = templates.data?.find((t) => t.id === templateId) ?? null;
  const texts = template
    ? { titleEn: template.titleEn, bodyEn: template.bodyEn, titleAr: template.titleAr, bodyAr: template.bodyAr }
    : { titleEn: title, bodyEn: body, titleAr: withArabic ? titleAr : null, bodyAr: withArabic ? bodyAr : null };
  const used = variablesIn(texts.titleEn, texts.bodyEn, texts.titleAr, texts.bodyAr);
  const fills = resolved.data?.fills ?? [];
  const unfillable = resolved.data ? used.filter((v) => !fills.includes(v)) : [];

  // ── Channels and when ──
  const [email, setEmail] = useState(true);
  const [when, setWhen] = useState<When>('now');
  const [pickedAt, setPickedAt] = useState('');
  const [saveAs, setSaveAs] = useState('');
  const [result, setResult] = useState<{ id: string; status: string; people: number; scheduledAt: string | null } | null>(null);
  const scheduledAt = when === 'tomorrow' ? tomorrowAtNine() : when === 'pick' ? cairoInstant(pickedAt) : null;

  const send = useMutation({
    mutationFn: () => apiResponse(api.v1.messages.$post({
      json: {
        audience: audience!,
        ...(template ? { templateId: template.id } : { title, body, ...(withArabic ? { titleAr, bodyAr } : {}) }),
        language: template ? language : withArabic ? 'both' : 'en',
        channels: email ? ['in_app', 'email'] : ['in_app'],
        ...(scheduledAt ? { scheduledAt } : {}),
        ...(contextSession ? { context: { sessionId: contextSession } } : {}),
        ...(saveAs.trim() ? { saveAudienceAs: saveAs.trim() } : {}),
      },
    })),
    onSuccess: (r) => {
      setResult({ id: r.id, status: r.status, people: r.people, scheduledAt: r.scheduledAt ? String(r.scheduledAt) : null });
      // The audience and the channels stay; the text and the time are the next message's.
      setTitle(''); setBody(''); setTitleAr(''); setBodyAr(''); setTemplateId(''); setWhen('now'); setPickedAt(''); setSaveAs('');
      queryClient.invalidateQueries({ queryKey: MESSAGES_KEY });
    },
  });

  const insertVariable = (v: MessageVariable) => {
    const el = bodyRef.current;
    const token = `{${v}}`;
    if (!el) { setBody((b) => b + token); return; }
    const start = el.selectionStart ?? body.length;
    const next = body.slice(0, start) + token + body.slice(el.selectionEnd ?? start);
    setBody(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  };

  const sample = resolved.data?.sample[0];
  const preview = sample && (texts.titleEn || texts.bodyEn) ? renderMessage(texts, template ? language : withArabic ? 'both' : 'en', sample.vars) : null;
  const ready = !!audience && !!resolved.data && resolved.data.people > 0 && unfillable.length === 0
    && (template ? true : title.trim().length >= 3 && body.trim().length >= 10 && (!withArabic || (titleAr.trim().length >= 3 && bodyAr.trim().length >= 10)))
    && (when !== 'pick' || !!scheduledAt);
  const broadcasts = (saved.data ?? []).filter((a) => a.kind === 'broadcast');
  const savedBatches = (saved.data ?? []).filter((a) => a.kind !== 'broadcast');

  return (
    <section aria-labelledby="new-message" className="rounded-xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-5 py-4">
        <h2 id="new-message" className="font-display text-base font-semibold text-foreground">New message</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {admin ? 'To everyone, a grade, the parents of a grade, a list the school already keeps, or chosen people.' : "To a session's unpaid families or the holders of a charge: the payment reminder, or your own words."}
        </p>
      </div>
      <div className="space-y-5 px-5 py-4">
        {result && (
          <Notice tone="success">
            {result.status === 'scheduled'
              ? <><span>Scheduled for</span> <InstantText iso={result.scheduledAt!} />. <span>It goes out at that minute; you can cancel it in the log until then.</span></>
              : <><span>{`Sent to ${countWords(result.people, 'person')}`}</span>. <span>The deliveries are in the log.</span></>}
          </Notice>
        )}

        {/* ── 1. Who ── */}
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-foreground">Who</legend>
          {admin && (
            <div className="flex rounded-lg border border-border bg-card p-0.5 text-sm" role="group" aria-label="Audience">
              {(['broadcast', 'batch', 'direct'] as const).map((k) => (
                <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
                  className={`flex-1 rounded-md px-3 py-1.5 ${kind === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                  {k === 'broadcast' ? 'Everyone or a grade' : k === 'batch' ? 'A list in the system' : 'Chosen people'}
                </button>
              ))}
            </div>
          )}
          {kind === 'broadcast' && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Groups">
              {broadcasts.map((a) => (
                <button key={a.id} type="button" aria-pressed={savedId === a.id} onClick={() => setSavedId(a.id)}
                  className={`rounded-full border px-3 py-1 text-sm ${savedId === a.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-accent'}`}>
                  {a.name}
                </button>
              ))}
            </div>
          )}
          {kind === 'batch' && (
            <div className="space-y-3">
              {savedBatches.length > 0 && (
                <p className="text-xs text-muted-foreground"><span>Saved lists:</span>{' '}
                  {savedBatches.map((a) => <button key={a.id} type="button" className="me-2 underline" onClick={() => { const d = a.definition as AudienceDefinitionType; if (d.kind === 'batch') { setList(d.list); if ('sessionId' in d) setSessionId(d.sessionId ?? ''); if ('sectionId' in d) setSectionId(d.sectionId ?? ''); setWho(d.who); } }}>{a.name}</button>)}
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-foreground">List</span>
                  <select className={INPUT_CLASS} value={list} onChange={(e) => setList(e.target.value as BatchList)}>
                    {(admin ? (['session_unpaid', 'section', 'teaching_group', 'offer_reservers', 'charge_holders'] as const) : (['session_unpaid', 'charge_holders'] as const))
                      .map((l) => <option key={l} value={l}>{BATCH_LIST_LABELS[l]}</option>)}
                  </select>
                </label>
                {(list === 'session_unpaid' || list === 'offer_reservers') && (
                  <label className="space-y-1 text-sm">
                    <span className="font-medium text-foreground">Session</span>
                    <select className={INPUT_CLASS} value={sessionId} onChange={(e) => { setSessionId(e.target.value); setOfferId(''); }}>
                      <option value="">Choose a session</option>
                      {(lists.data?.sessions ?? []).map((s) => <option key={s.id} value={s.id} data-i18n-skip="true">{s.name}</option>)}
                    </select>
                  </label>
                )}
                {list === 'offer_reservers' && (
                  <label className="space-y-1 text-sm">
                    <span className="font-medium text-foreground">Subject</span>
                    <select className={INPUT_CLASS} value={offerId} onChange={(e) => setOfferId(e.target.value)} disabled={!sessionId}>
                      <option value="">Choose a subject</option>
                      {(lists.data?.offers ?? []).map((o) => <option key={o.id} value={o.id} data-i18n-skip="true">{o.subject}</option>)}
                    </select>
                  </label>
                )}
                {list === 'section' && (
                  <label className="space-y-1 text-sm">
                    <span className="font-medium text-foreground">Section</span>
                    <select className={INPUT_CLASS} value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                      <option value="">Choose a section</option>
                      {(lists.data?.sections ?? []).map((s) => <option key={s.id} value={s.id} data-i18n-skip="true">{s.name}</option>)}
                    </select>
                  </label>
                )}
                {list === 'teaching_group' && (
                  <label className="space-y-1 text-sm">
                    <span className="font-medium text-foreground">Teaching group</span>
                    <select className={INPUT_CLASS} value={groupKey} onChange={(e) => setGroupKey(e.target.value)}>
                      <option value="">Choose a group</option>
                      {(lists.data?.teachingGroups ?? []).map((g) => {
                        const k = `${g.subjectId}|${g.unitId ?? ''}|${g.teacherId ?? ''}`;
                        return <option key={k} value={k} data-i18n-skip="true">{g.label}</option>;
                      })}
                    </select>
                  </label>
                )}
                {list === 'charge_holders' && (
                  <>
                    <label className="space-y-1 text-sm">
                      <span className="font-medium text-foreground">Charge</span>
                      <select className={INPUT_CLASS} value={chargeKind} onChange={(e) => setChargeKind(e.target.value as ChargeKind)}>
                        {(lists.data?.chargeKinds ?? []).map((k) => <option key={k.value} value={k.value}>{CHARGE_KIND_LABELS[k.value]}</option>)}
                      </select>
                    </label>
                    {chargeKind === 'school_fee_push' && (
                      <label className="space-y-1 text-sm">
                        <span className="font-medium text-foreground">Year</span>
                        <select className={INPUT_CLASS} value={academicYear} onChange={(e) => setAcademicYear(e.target.value)}>
                          <option value="">Any year</option>
                          {(lists.data?.schoolFeeYears ?? []).map((y) => <option key={y} value={y} data-i18n-skip="true">{y}</option>)}
                        </select>
                      </label>
                    )}
                  </>
                )}
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-foreground">To</span>
                  <select className={INPUT_CLASS} value={who} onChange={(e) => setWho(e.target.value as AudienceWho)}>
                    {(['families', 'parents', 'students'] as const).map((w) => <option key={w} value={w}>{WHO_LABELS[w]}</option>)}
                  </select>
                </label>
              </div>
            </div>
          )}
          {kind === 'direct' && <PeoplePicker chosen={people} onChange={setPeople} />}
          <AudienceSummary resolved={resolved.data} loading={resolved.isFetching} error={resolved.error as Error | null} />
          {admin && kind !== 'direct' && audience && (
            <label className="block max-w-sm space-y-1 text-sm">
              <span className="text-muted-foreground">Keep this list in the picker as (optional)</span>
              <input className={INPUT_CLASS} value={saveAs} onChange={(e) => setSaveAs(e.target.value)} placeholder="e.g. Section 11C parents" />
            </label>
          )}
        </fieldset>

        {/* ── 2. What ── */}
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-foreground">What</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">Text</span>
              <select className={INPUT_CLASS} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Write the text</option>
                {(templates.data ?? []).filter((t) => t.active && !variablesIn(t.titleEn, t.bodyEn).some((v) => v === 'series' || v === 'count')).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            {template && (
              <label className="space-y-1 text-sm">
                <span className="font-medium text-foreground">Language</span>
                <select className={INPUT_CLASS} value={language} onChange={(e) => setLanguage(e.target.value as 'both' | 'en' | 'ar')}>
                  <option value="both">English and Arabic</option>
                  <option value="en">English</option>
                  <option value="ar">Arabic</option>
                </select>
              </label>
            )}
          </div>
          {!template && (
            <div className="space-y-3">
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-foreground">Title</span>
                <input className={INPUT_CLASS} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium text-foreground">Message</span>
                <textarea ref={bodyRef} className={TEXTAREA_CLASS} rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} />
              </label>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">Insert:</span>
                {MESSAGE_VARIABLES.filter((v) => v !== 'series' && v !== 'count').map((v) => {
                  const can = !resolved.data || fills.includes(v);
                  return (
                    <button key={v} type="button" disabled={!can} onClick={() => insertVariable(v)} title={can ? MESSAGE_VARIABLE_LABELS[v] : 'This audience cannot fill it'}
                      className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-foreground hover:bg-accent disabled:opacity-40" data-i18n-skip="true">
                      {`{${v}}`}
                    </button>
                  );
                })}
              </div>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={withArabic} onChange={(e) => setWithArabic(e.target.checked)} />
                <span>Also in Arabic</span>
              </label>
              {withArabic && (
                <div className="space-y-3" dir="rtl">
                  <input className={INPUT_CLASS} value={titleAr} onChange={(e) => setTitleAr(e.target.value)} aria-label="Arabic title" maxLength={150} />
                  <textarea className={TEXTAREA_CLASS} rows={4} value={bodyAr} onChange={(e) => setBodyAr(e.target.value)} aria-label="Arabic message" maxLength={4000} />
                </div>
              )}
            </div>
          )}
          {unfillable.length > 0 && (
            <Notice tone="warning">
              <span>This audience cannot fill</span> <span data-i18n-skip="true">{unfillable.map((v) => `{${v}}`).join(' ')}</span>
              <span>: choose a list that has it, or take it out of the text.</span>
            </Notice>
          )}
          {preview && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm" aria-label="Preview">
              <p className="text-xs text-muted-foreground"><span>Preview — the copy for</span> <bdi data-i18n-skip="true">{sample!.name}</bdi></p>
              <p className="mt-1 font-semibold text-foreground" data-i18n-skip="true"><bdi>{preview.title}</bdi></p>
              <div className="mt-1 space-y-2 text-foreground" data-i18n-skip="true">
                {preview.body.split(/\n{2,}/).map((p, i) => <p key={i} dir="auto" className="whitespace-pre-line">{p}</p>)}
              </div>
            </div>
          )}
        </fieldset>

        {/* ── 3. How and when ── */}
        <fieldset className="flex flex-wrap items-end gap-6">
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-foreground">Channels</p>
            <div className="flex flex-wrap gap-4">
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked disabled /> <span>In the app</span></label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> <span>Email</span></label>
              <label className="inline-flex items-center gap-2 text-muted-foreground" title="The school has no WhatsApp Business account yet">
                <input type="checkbox" disabled /> <span>WhatsApp</span> <span className="text-xs">(no business account yet)</span>
              </label>
            </div>
          </div>
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-foreground">When</p>
            <div className="flex rounded-lg border border-border bg-card p-0.5" role="group" aria-label="When">
              {(['now', 'tomorrow', 'pick'] as const).map((w) => (
                <button key={w} type="button" aria-pressed={when === w} onClick={() => setWhen(w)}
                  className={`rounded-md px-3 py-1.5 ${when === w ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                  {w === 'now' ? 'Now' : w === 'tomorrow' ? 'Tomorrow 09:00' : 'Pick a time'}
                </button>
              ))}
            </div>
          </div>
          {when === 'pick' && (
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Cairo time</span>
              <input type="datetime-local" className={INPUT_CLASS} value={pickedAt} onChange={(e) => setPickedAt(e.target.value)} />
            </label>
          )}
          {admin && kind === 'broadcast' && used.some((v) => v === 'session' || v === 'closes') && (
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Session for {'{session}'}</span>
              <select className={INPUT_CLASS} value={contextSession} onChange={(e) => setContextSession(e.target.value)}>
                <option value="">None</option>
                {(lists.data?.sessions ?? []).map((s) => <option key={s.id} value={s.id} data-i18n-skip="true">{s.name}</option>)}
              </select>
            </label>
          )}
        </fieldset>

        {send.isError && <Notice tone="danger">{(send.error as Error).message}</Notice>}
        <div className="flex items-center gap-3">
          <Button onClick={() => send.mutate()} disabled={!ready || send.isPending}>
            {send.isPending ? 'Sending…' : scheduledAt
              ? <><span>Schedule for</span> <InstantText iso={scheduledAt.toISOString()} /></>
              : resolved.data ? <span>{`Send to ${countWords(resolved.data.people, 'person')}`}</span> : 'Send'}
          </Button>
        </div>
      </div>
    </section>
  );
}

function AudienceSummary({ resolved, loading, error }: { resolved: Resolved | undefined; loading: boolean; error: Error | null }) {
  if (error) return <Notice tone="danger">{error.message}</Notice>;
  if (!resolved) return loading ? <p className="text-sm text-muted-foreground">Counting…</p> : null;
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
      <p className="text-foreground">
        <Badge tone={resolved.people > 0 ? 'info' : 'warning'}><span>{countWords(resolved.people, 'person')}</span></Badge>{' '}
        {resolved.messages !== resolved.people && <span className="text-muted-foreground"><span>{`${countWords(resolved.messages, 'message')}, one about each child`}</span></span>}
        {' '}<span className="text-muted-foreground">{resolved.label}</span>
      </p>
      {resolved.sample.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {resolved.sample.slice(0, 6).map((s, i) => (
            <span key={i}>{i > 0 && ' · '}<bdi data-i18n-skip="true">{s.name}</bdi> (<span>{ROLE_WORD[s.role] ?? s.role}</span>{s.student && <>, <bdi data-i18n-skip="true">{s.student}</bdi></>})</span>
          ))}
          {resolved.messages > 6 && <span> …</span>}
        </p>
      )}
      {resolved.people === 0 && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Nobody is in this audience now.</p>}
    </div>
  );
}

/** Chosen people: search by name, email or student number (the admin's user search), pick, remove. */
function PeoplePicker({ chosen, onChange }: { chosen: { id: string; name: string; role: string | null }[]; onChange: (p: { id: string; name: string; role: string | null }[]) => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const found = useQuery({ queryKey: ['users', 'search', debounced], queryFn: () => fetchPeople(debounced), enabled: debounced.length >= 2 });
  return (
    <div className="space-y-2">
      <input className={INPUT_CLASS} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search families, students and staff by name or email" aria-label="Search people" />
      {debounced.length >= 2 && (found.data ?? []).length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-lg border border-border bg-background text-sm">
          {(found.data ?? []).slice(0, 20).map((u) => (
            <li key={u.id}>
              <button type="button" className="flex w-full items-center justify-between px-3 py-1.5 text-start hover:bg-accent" disabled={chosen.some((c) => c.id === u.id)}
                onClick={() => { onChange([...chosen, { id: u.id, name: u.name, role: u.role ?? null }]); setQ(''); }}>
                <bdi data-i18n-skip="true">{u.name}</bdi>
                <span className="text-xs text-muted-foreground">{ROLE_WORD[u.role ?? ''] ?? u.role}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chosen.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-0.5 text-sm">
              <bdi data-i18n-skip="true">{p.name}</bdi>
              <button type="button" aria-label="Remove" className="text-muted-foreground hover:text-foreground" onClick={() => onChange(chosen.filter((c) => c.id !== p.id))}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
