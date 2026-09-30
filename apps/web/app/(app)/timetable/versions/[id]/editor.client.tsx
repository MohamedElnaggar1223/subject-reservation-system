'use client';

/**
 * The timetable grid (FEATURES_PLAN.md F1, "Grid editor").
 *
 * The spreadsheet version: one sheet per class with days across and periods
 * down, a teacher's name typed in each cell, and a second sheet per teacher
 * kept "in step" by hand. A clash — a teacher in two rooms, a student in two
 * option blocks at once — is found when someone reads both sheets side by
 * side, usually on the first day of term. Moving one lesson means editing
 * every sheet it appears on and remembering which.
 *
 * Here: one timetable, seen by section, teacher, room, student or the whole
 * school. Pick a lesson up (drag it, or click it and then click where it goes
 * — the same on a tablet or with the keyboard) and every cell turns green
 * where it fits or red where it would clash, with the reason on the cell and
 * in the panel before you let go. A move that clashes asks first; the clash
 * list says what is wrong after. The generator places everything not locked,
 * explains what it could not place, and the measures show what it achieved.
 * Publishing takes effect on a date and tells students, parents and teachers.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, optionsFor, WEEKDAY_NAMES, type SlotOption } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice, TONE_CLASSES } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { SELECT_CLASS, DateText } from '../../../academic/calendar/academic-shared';
import { TT_KEY, TimetableTabs, fetchTimetable, download, schoolToday, type Editor, type EditorLesson, type EditorClash } from '../../timetable-shared';

type View = 'section' | 'teacher' | 'room' | 'student' | 'school';
const VIEWS: { key: View; label: string }[] = [
  { key: 'section', label: 'Section' },
  { key: 'teacher', label: 'Teacher' },
  { key: 'room', label: 'Room' },
  { key: 'student', label: 'Student' },
  { key: 'school', label: 'Whole school' },
];

/** A group's colour from the theme's chart colours, by its place in the list. */
const colourOf = (i: number) => `var(--chart-${(i % 5) + 1})`;

export default function EditorClient({ id }: { id: string }): React.JSX.Element {
  const { data: tt, isLoading, isError, refetch } = useQuery({ queryKey: [...TT_KEY, 'editor', id], queryFn: () => fetchTimetable(id) });
  if (isLoading) return <div className="mx-auto max-w-7xl px-6 py-8"><LoadingState label="Loading the timetable…" /></div>;
  if (isError || !tt) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-8">
        <ErrorState title="The timetable did not load" message="This is a connection problem, not an empty timetable." onRetry={() => refetch()} />
      </div>
    );
  }
  return <EditorBody tt={tt} />;
}

function EditorBody({ tt }: { tt: Editor }) {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const id = tt.timetable.id;
  const draft = tt.timetable.status === 'draft';
  const key = [...TT_KEY, 'editor', id];

  // ── What is shown ──
  const sections = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of tt.groups) {
      for (const s of g.sections) m.set(s.id, s.name);
      if (g.sectionId && g.sectionName) m.set(g.sectionId, g.sectionName);
    }
    return [...m.entries()].map(([sid, name]) => ({ id: sid, name })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [tt.groups]);
  const rooms = useMemo(() => tt.engine.rooms.filter((r) => r.isActive).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [tt.engine.rooms]);
  const view = (params.get('view') as View | null) ?? 'section';
  const listFor = (v: View) =>
    v === 'section' ? sections : v === 'teacher' ? tt.teachers : v === 'room' ? rooms : v === 'student' ? tt.students.map((s) => ({ id: s.id, name: s.section ? `${s.name} (${s.section.name})` : s.name })) : [];
  const entities = listFor(view);
  const entityId = params.get('of') && entities.some((e) => e.id === params.get('of')) ? params.get('of')! : entities[0]?.id ?? null;
  const setView = (v: View, of?: string | null) => {
    const q = new URLSearchParams(params.toString());
    q.set('view', v);
    const list = listFor(v);
    const next = of ?? list[0]?.id ?? null;
    if (next) q.set('of', next);
    else q.delete('of');
    router.replace(`${pathname}?${q.toString()}` as Route, { scroll: false });
  };

  const groupIndex = useMemo(() => new Map(tt.groups.map((g, i) => [g.id, i])), [tt.groups]);
  const groupById = useMemo(() => new Map(tt.groups.map((g) => [g.id, g])), [tt.groups]);
  const roomName = useCallback((rid: string | null) => (rid ? tt.engine.rooms.find((r) => r.id === rid)?.name ?? '' : ''), [tt.engine.rooms]);
  const inView = useCallback((l: EditorLesson, v: View = view, of: string | null = entityId) => {
    const g = groupById.get(l.groupId);
    if (!g || !of) return v === 'school';
    if (v === 'section') return g.sectionId === of || g.sections.some((s) => s.id === of);
    if (v === 'teacher') return g.teacherId === of;
    if (v === 'room') return l.roomId === of;
    if (v === 'student') return g.memberIds.includes(of);
    return true;
  }, [groupById, view, entityId]);

  const clashesOf = useMemo(() => {
    const m = new Map<string, EditorClash[]>();
    for (const c of tt.clashes) for (const lid of c.lessonIds) m.set(lid, [...(m.get(lid) ?? []), c]);
    return m;
  }, [tt.clashes]);

  // ── Picking a lesson up ──
  const [picked, setPicked] = useState<string | null>(null);
  const [hover, setHover] = useState<{ weekday: number; period: number } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ lessonId: string; weekday: number; period: number; option: SlotOption } | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const pickedLesson = picked ? tt.engine.lessons.find((l) => l.id === picked) ?? null : null;
  const options = useMemo(() => {
    const m = new Map<string, SlotOption>();
    if (!picked || !draft) return m;
    for (const o of optionsFor(tt.engine, picked)) m.set(`${o.weekday}:${o.period}`, o);
    return m;
  }, [picked, draft, tt.engine]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPicked(null); setHover(null); setConfirm(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const move = useMutation({
    mutationFn: async (v: { lessonId: string; weekday: number; period: number; roomId?: string | null; allowClash?: boolean }) => {
      const l = tt.engine.lessons.find((x) => x.id === v.lessonId)!;
      return apiResponse(api.v1.timetables[':id'].lessons[':lessonId'].move.$post({
        param: { id, lessonId: v.lessonId },
        json: { weekday: v.weekday, period: v.period, from: { weekday: l.weekday, period: l.period }, ...(v.roomId !== undefined ? { roomId: v.roomId } : {}), ...(v.allowClash ? { allowClash: true } : {}) },
      }));
    },
    onSuccess: (r) => setFlash(r.clashes.length ? `Placed with ${r.clashes.length === 1 ? 'a clash' : `${r.clashes.length} clashes`}: ${r.clashes.map((c) => c.message).join('; ')}` : null),
    onError: (e) => setFlash(e instanceof Error ? e.message : 'The lesson did not move'),
    onSettled: () => { setPicked(null); setHover(null); setConfirm(null); qc.invalidateQueries({ queryKey: key }); },
  });
  const unplace = useMutation({
    mutationFn: async (lessonId: string) => {
      const l = tt.engine.lessons.find((x) => x.id === lessonId)!;
      return apiResponse(api.v1.timetables[':id'].lessons[':lessonId'].unplace.$post({ param: { id, lessonId }, json: { from: { weekday: l.weekday, period: l.period } } }));
    },
    onError: (e) => setFlash(e instanceof Error ? e.message : 'The lesson did not move'),
    onSettled: () => { setPicked(null); qc.invalidateQueries({ queryKey: key }); },
  });
  const lock = useMutation({
    mutationFn: async (v: { lessonId: string; locked: boolean }) =>
      apiResponse(api.v1.timetables[':id'].lessons[':lessonId'].lock.$post({ param: { id, lessonId: v.lessonId }, json: { locked: v.locked } })),
    onError: (e) => setFlash(e instanceof Error ? e.message : 'The lock did not change'),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const attempt = (lessonId: string, weekday: number, period: number) => {
    const l = tt.engine.lessons.find((x) => x.id === lessonId);
    if (!l || (l.weekday === weekday && l.period === period)) { setPicked(null); setHover(null); return; }
    const o = optionsFor(tt.engine, lessonId).find((x) => x.weekday === weekday && x.period === period);
    if (!o) return;
    if (o.ok) move.mutate({ lessonId, weekday, period });
    else setConfirm({ lessonId, weekday, period, option: o });
  };

  // ── The measures ──
  const placed = tt.engine.lessons.filter((l) => l.weekday !== null).length;
  const total = tt.engine.lessons.length;
  const unplacedInView = tt.engine.lessons.filter((l) => l.weekday === null && (view === 'school' || inView(l)));
  const hoverOption = hover ? options.get(`${hover.weekday}:${hover.period}`) : undefined;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 lg:px-6 animate-fade-up">
      <TimetableTabs year={tt.academicYear.startYear} />
      <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={`/timetable/versions?year=${tt.academicYear.startYear}` as Route} className="text-sm text-muted-foreground hover:text-foreground print:hidden">← Timetables</Link>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-foreground">
            <bdi>{tt.timetable.name}</bdi>
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <bdi>{tt.term.name}</bdi>
            <span aria-hidden="true">·</span>
            {draft ? <Badge tone="warning">Draft</Badge> : <Badge tone="success">Published</Badge>}
            {tt.timetable.effectiveFrom && (
              <span>
                Takes effect <DateText date={tt.timetable.effectiveFrom} weekday long />
              </span>
            )}
            {tt.bellScheduleName && (
              <>
                <span aria-hidden="true">·</span>
                <span>Bells:</span> <bdi>{tt.bellScheduleName}</bdi>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {draft && <GenerateButton tt={tt} onDone={() => qc.invalidateQueries({ queryKey: key })} />}
          <PublishButton tt={tt} />
          <ExportMenu tt={tt} />
          <Button variant="outline" asChild>
            <Link href={`/timetable/versions/${id}/print?view=${view === 'school' ? 'section' : view}` as Route}>Print</Link>
          </Button>
        </div>
      </header>

      <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Measure label="Placed" value={`${placed} / ${total}`} tone={placed === total ? 'success' : 'warning'} />
        <Measure label="Clashes" value={String(tt.clashes.length)} tone={tt.clashes.length ? 'danger' : 'success'} />
        <Measure label="Same-day repeats" value={String(tt.measures.sameDayRepeats)} tone={tt.measures.sameDayRepeats ? 'warning' : 'success'} hint="A group with two lessons on one day (a double counts once)" />
        <Measure label="Teacher gaps" value={String(tt.measures.teacherGaps)} tone="neutral" hint="Free periods between a teacher's first and last lesson of a day, over the week" />
        <Measure label="Uneven days" value={String(tt.measures.teacherDaySpread)} tone="neutral" hint="Over teachers: the busiest day's periods minus the quietest day's" />
      </dl>

      {tt.problems.map((p) => (
        <Notice key={p} tone="warning" className="mb-3 print:hidden">{p}</Notice>
      ))}
      {!draft && (
        <Notice tone="info" className="mb-3 print:hidden">
          A published timetable does not change. To change it, make a new draft from it on the Timetables screen and publish that from a later date.
        </Notice>
      )}
      {flash && (
        <Notice tone={flash.startsWith('Placed with') ? 'warning' : 'danger'} className="mb-3 print:hidden">
          <span>{flash}</span>{' '}
          <button type="button" className="font-semibold underline underline-offset-2" onClick={() => setFlash(null)}>Dismiss</button>
        </Notice>
      )}

      {/* View and who */}
      <div className="mb-4 flex flex-wrap items-end gap-3 print:hidden">
        <div role="tablist" aria-label="View" className="flex rounded-lg border border-border bg-card p-1">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              role="tab"
              type="button"
              aria-selected={view === v.key}
              onClick={() => setView(v.key)}
              className={cn('rounded-md px-3 py-1.5 text-sm font-medium', view === v.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground')}
            >
              {v.label}
            </button>
          ))}
        </div>
        {view !== 'school' && (
          <div className="min-w-56">
            <Label htmlFor="tt-entity" className="mb-1 text-xs text-muted-foreground">
              {VIEWS.find((v) => v.key === view)!.label}
            </Label>
            <select id="tt-entity" value={entityId ?? ''} onChange={(e) => setView(view, e.target.value)} className={SELECT_CLASS}>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
        )}
        {picked && (
          <p className="pb-2 text-sm text-muted-foreground" aria-live="polite">
            Moving <bdi className="font-semibold text-foreground">{groupById.get(pickedLesson!.groupId)?.name}</bdi>: green fits, red clashes. Click a cell or drop it there; Escape puts it back.
          </p>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          {view === 'school' ? (
            <SchoolGrid tt={tt} sections={sections} picked={picked} options={options} clashesOf={clashesOf} highlight={highlight} colourOf={(g) => colourOf(groupIndex.get(g) ?? 0)}
              draft={draft} onPick={(l) => setPicked(picked === l ? null : l)} onTarget={(w, p) => picked && attempt(picked, w, p)} onHover={setHover} />
          ) : (
            <EntityGrid tt={tt} lessons={tt.engine.lessons.filter((l) => l.weekday !== null && inView(l))} view={view} entityId={entityId}
              picked={picked} options={options} clashesOf={clashesOf} highlight={highlight} roomName={roomName} colourOf={(g) => colourOf(groupIndex.get(g) ?? 0)}
              draft={draft} onPick={(l) => setPicked(picked === l ? null : l)} onTarget={(w, p) => picked && attempt(picked, w, p)} onHover={setHover}
              onDragStart={(l) => setPicked(l)} onDropAt={(l, w, p) => attempt(l, w, p)} />
          )}

          {/* Not on the grid */}
          <section aria-labelledby="unplaced-title" className="rounded-xl border border-border bg-card p-4 shadow-sm print:hidden">
            <h2 id="unplaced-title" className="font-display text-base font-bold text-foreground">
              Not on the grid <span className="font-normal text-muted-foreground">({unplacedInView.length})</span>
            </h2>
            {unplacedInView.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Every lesson here has a place.</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {unplacedInView.map((l) => (
                  <LessonCard key={l.id} tt={tt} lesson={l} roomName={roomName} colour={colourOf(groupIndex.get(l.groupId) ?? 0)} picked={picked === l.id}
                    clashes={[]} highlighted={highlight.includes(l.id)} draggable={draft} onPick={() => setPicked(picked === l.id ? null : l.id)} onDragStart={() => setPicked(l.id)} view={view} entityId={entityId} />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* The side panel: the picked lesson, where it would go, and what clashes now */}
        <aside className="space-y-4 print:hidden">
          {pickedLesson && (
            <PickedPanel tt={tt} lesson={pickedLesson} draft={draft} hover={hover} hoverOption={hoverOption} roomName={roomName}
              onRoom={(roomId) => pickedLesson.weekday !== null && move.mutate({ lessonId: pickedLesson.id, weekday: pickedLesson.weekday, period: pickedLesson.period!, roomId, allowClash: false })}
              onLock={(locked) => lock.mutate({ lessonId: pickedLesson.id, locked })}
              onUnplace={() => unplace.mutate(pickedLesson.id)}
              onClose={() => setPicked(null)} pending={move.isPending || unplace.isPending || lock.isPending} />
          )}
          <ClashList clashes={tt.clashes} onShow={(ids) => setHighlight(ids)} />
          <RunPanel tt={tt} />
        </aside>
      </div>

      {confirm && (
        <ConfirmClash
          tt={tt}
          confirm={confirm}
          pending={move.isPending}
          onCancel={() => { setConfirm(null); setPicked(null); }}
          onPlace={() => move.mutate({ lessonId: confirm.lessonId, weekday: confirm.weekday, period: confirm.period, allowClash: true })}
        />
      )}
    </div>
  );
}

function Measure({ label, value, tone, hint }: { label: string; value: string; tone: 'success' | 'warning' | 'danger' | 'neutral'; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm" title={hint}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('mt-0.5 inline-block rounded-md px-1.5 text-xl font-bold tabular-nums', tone !== 'neutral' && TONE_CLASSES[tone])}>
        <bdi>{value}</bdi>
      </dd>
    </div>
  );
}

// ─── A lesson card ───────────────────────────────────────────────────────────

function LessonCard({
  tt, lesson, roomName, colour, picked, clashes, highlighted, draggable, onPick, onDragStart, view, entityId, part,
}: {
  tt: Editor; lesson: EditorLesson; roomName: (id: string | null) => string; colour: string; picked: boolean; clashes: EditorClash[]; highlighted: boolean;
  draggable: boolean; onPick: () => void; onDragStart: () => void; view: View; entityId: string | null; part?: 'first' | 'second';
}) {
  const g = tt.groups.find((x) => x.id === lesson.groupId)!;
  const inSection = view === 'section' && entityId ? g.sections.find((s) => s.id === entityId) : undefined;
  const label = `${g.name}${lesson.length === 2 ? ' (double)' : ''}${g.teacherName ? `, ${g.teacherName}` : ''}${lesson.roomId ? `, ${roomName(lesson.roomId)}` : ''}${clashes.length ? `. Clash: ${clashes.map((c) => c.message).join('; ')}` : ''}`;
  return (
    <button
      type="button"
      draggable={draggable && !lesson.locked}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', lesson.id); e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onClick={(e) => { e.stopPropagation(); onPick(); }}
      aria-pressed={picked}
      aria-label={label}
      title={label}
      style={{ borderInlineStartColor: colour }}
      className={cn(
        'group relative w-full min-w-0 rounded-md border border-border border-s-4 bg-card px-2 py-1 text-start text-xs shadow-xs transition-shadow',
        draggable && !lesson.locked && 'cursor-grab active:cursor-grabbing',
        picked && 'ring-2 ring-primary',
        clashes.length > 0 && 'ring-2 ring-destructive',
        highlighted && 'ring-2 ring-amber-400',
      )}
    >
      <span className="block truncate font-semibold text-foreground"><bdi>{g.name}</bdi></span>
      <span className="block truncate text-muted-foreground">
        {g.teacherName ? <bdi>{g.teacherName}</bdi> : <span className="italic">No teacher yet</span>}
      </span>
      <span className="flex items-center gap-1 truncate text-muted-foreground">
        {lesson.roomId ? <bdi>{roomName(lesson.roomId)}</bdi> : <span className="italic">No room</span>}
        {inSection && <span className="ms-auto shrink-0 tabular-nums"><bdi>{inSection.count}</bdi>/<bdi>{g.memberIds.length}</bdi></span>}
      </span>
      <span className="absolute end-1 top-1 flex gap-0.5">
        {lesson.length === 2 && <span className="rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground">{part === 'second' ? '2/2' : '1/2'}</span>}
        {lesson.locked && <span aria-hidden="true" className="text-[11px]">🔒</span>}
        {clashes.length > 0 && <span aria-hidden="true" className="rounded bg-destructive px-1 text-[10px] font-bold text-white">!</span>}
      </span>
    </button>
  );
}

// ─── One entity's week ───────────────────────────────────────────────────────

function EntityGrid({
  tt, lessons, view, entityId, picked, options, clashesOf, highlight, roomName, colourOf: colour, draft, onPick, onTarget, onHover, onDragStart, onDropAt,
}: {
  tt: Editor; lessons: EditorLesson[]; view: View; entityId: string | null; picked: string | null; options: Map<string, SlotOption>;
  clashesOf: Map<string, EditorClash[]>; highlight: string[]; roomName: (id: string | null) => string; colourOf: (groupId: string) => string; draft: boolean;
  onPick: (lessonId: string) => void; onTarget: (weekday: number, period: number) => void; onHover: (h: { weekday: number; period: number } | null) => void;
  onDragStart: (lessonId: string) => void; onDropAt: (lessonId: string, weekday: number, period: number) => void;
}) {
  const days = tt.engine.days;
  const maxP = Math.max(0, ...days.map((d) => d.periods.length));
  if (!days.length) return <Notice tone="warning">No lesson periods to show: set up the year&apos;s default bell schedule on the Bell schedules screen.</Notice>;
  const rows = Array.from({ length: maxP }, (_, i) => i + 1);
  const first = days[0]!;
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
      <table className="w-full min-w-[720px] table-fixed border-collapse text-sm">
        <caption className="sr-only">Lessons by day and period</caption>
        <thead>
          <tr>
            <th scope="col" className="w-24 border-b border-border px-2 py-2 text-start text-xs font-medium text-muted-foreground">Period</th>
            {days.map((d) => (
              <th key={d.weekday} scope="col" className="border-b border-s border-border px-2 py-2 text-start text-xs font-semibold text-foreground">{WEEKDAY_NAMES[d.weekday]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const label = first.periods.find((x) => x.period === p);
            return (
              <tr key={p}>
                <th scope="row" className="border-t border-border px-2 py-1 text-start align-top">
                  <span className="block text-sm font-semibold text-foreground">{label?.label ?? `P${p}`}</span>
                  {label && <span className="block text-[11px] tabular-nums text-muted-foreground" dir="ltr">{label.startsAt}–{label.endsAt}</span>}
                </th>
                {days.map((d) => {
                  const exists = d.periods.some((x) => x.period === p);
                  const here = lessons.filter((l) => l.weekday === d.weekday && l.period! <= p && p <= l.period! + l.length - 1);
                  const o = options.get(`${d.weekday}:${p}`);
                  const tone = picked && o ? (o.ok ? TONE_CLASSES.success : TONE_CLASSES.danger) : '';
                  const why = o && !o.ok ? o.reasons.map((r) => r.message).join('; ') : o ? 'Fits here' : undefined;
                  return (
                    <td
                      key={d.weekday}
                      className={cn('h-20 border-s border-t border-border p-1 align-top', !exists && 'bg-muted/50', tone)}
                      title={why}
                      onDragOver={(e) => { if (draft && picked && exists) { e.preventDefault(); onHover({ weekday: d.weekday, period: p }); } }}
                      onDragLeave={() => onHover(null)}
                      onDrop={(e) => { e.preventDefault(); const lid = e.dataTransfer.getData('text/plain') || picked; if (lid && exists) onDropAt(lid, d.weekday, p); }}
                      onMouseEnter={() => picked && onHover({ weekday: d.weekday, period: p })}
                      onClick={() => draft && picked && exists && onTarget(d.weekday, p)}
                    >
                      <div className="flex h-full flex-col gap-1">
                        {here.map((l) => (
                          <LessonCard key={l.id} tt={tt} lesson={l} roomName={roomName} colour={colour(l.groupId)} picked={picked === l.id}
                            clashes={clashesOf.get(l.id) ?? []} highlighted={highlight.includes(l.id)} draggable={draft} onPick={() => onPick(l.id)}
                            onDragStart={() => onDragStart(l.id)} view={view} entityId={entityId} part={l.period === p ? 'first' : 'second'} />
                        ))}
                        {picked && draft && exists && here.length === 0 && (
                          <span className="sr-only">
                            <button type="button" onClick={() => onTarget(d.weekday, p)}>{`Move here: ${WEEKDAY_NAMES[d.weekday]} ${label?.label ?? p}${o && !o.ok ? ` (clash: ${why})` : ''}`}</button>
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── The whole school at once ────────────────────────────────────────────────

function SchoolGrid({
  tt, sections, picked, options, clashesOf, highlight, colourOf: colour, draft, onPick, onTarget, onHover,
}: {
  tt: Editor; sections: { id: string; name: string }[]; picked: string | null; options: Map<string, SlotOption>; clashesOf: Map<string, EditorClash[]>;
  highlight: string[]; colourOf: (groupId: string) => string; draft: boolean; onPick: (lessonId: string) => void;
  onTarget: (weekday: number, period: number) => void; onHover: (h: { weekday: number; period: number } | null) => void;
}) {
  const days = tt.engine.days;
  const cols = days.flatMap((d) => d.periods.map((p) => ({ weekday: d.weekday, period: p.period, label: p.label })));
  const groupsOf = (sid: string) => tt.groups.filter((g) => g.sectionId === sid || g.sections.some((s) => s.id === sid)).map((g) => g.id);
  const unsectioned = tt.groups.filter((g) => !g.sectionId && g.sections.length === 0).map((g) => g.id);
  const rows = [...sections.map((s) => ({ id: s.id, name: s.name, groups: groupsOf(s.id) })), ...(unsectioned.length ? [{ id: '__other', name: 'Other groups', groups: unsectioned }] : [])];
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
      <table className="border-collapse text-xs">
        <caption className="sr-only">Every section's lessons across the week</caption>
        <thead>
          <tr>
            <th scope="col" rowSpan={2} className="sticky start-0 z-10 w-28 border-b border-border bg-card px-2 py-1 text-start font-medium text-muted-foreground">Section</th>
            {days.map((d) => (
              <th key={d.weekday} scope="colgroup" colSpan={d.periods.length} className="border-b border-s border-border px-2 py-1 text-start font-semibold text-foreground">{WEEKDAY_NAMES[d.weekday]}</th>
            ))}
          </tr>
          <tr>
            {cols.map((c) => {
              const o = options.get(`${c.weekday}:${c.period}`);
              return (
                <th
                  key={`${c.weekday}:${c.period}`}
                  scope="col"
                  className={cn('min-w-[88px] border-b border-s border-border px-1 py-1 font-medium text-muted-foreground', picked && o && (o.ok ? TONE_CLASSES.success : TONE_CLASSES.danger))}
                  title={o ? (o.ok ? 'Fits here' : o.reasons.map((r) => r.message).join('; ')) : undefined}
                  onMouseEnter={() => picked && onHover({ weekday: c.weekday, period: c.period })}
                  onClick={() => draft && picked && onTarget(c.weekday, c.period)}
                >
                  {c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="sticky start-0 z-10 border-t border-border bg-card px-2 py-1 text-start font-semibold text-foreground"><bdi>{r.name}</bdi></th>
              {cols.map((c) => {
                const here = tt.engine.lessons.filter((l) => r.groups.includes(l.groupId) && l.weekday === c.weekday && l.period! <= c.period && c.period <= l.period! + l.length - 1);
                const o = options.get(`${c.weekday}:${c.period}`);
                return (
                  <td key={`${c.weekday}:${c.period}`} className={cn('h-12 border-s border-t border-border p-0.5 align-top', picked && o && (o.ok ? TONE_CLASSES.success : TONE_CLASSES.danger))}
                    onClick={() => draft && picked && onTarget(c.weekday, c.period)}>
                    {here.map((l) => {
                      const g = tt.groups.find((x) => x.id === l.groupId)!;
                      const clashes = clashesOf.get(l.id) ?? [];
                      return (
                        <button
                          key={l.id}
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onPick(l.id); }}
                          title={`${g.name}${g.teacherName ? `, ${g.teacherName}` : ''}${clashes.length ? `. Clash: ${clashes.map((x) => x.message).join('; ')}` : ''}`}
                          style={{ borderInlineStartColor: colour(l.groupId) }}
                          className={cn('mb-0.5 block w-full truncate rounded border border-border border-s-4 bg-card px-1 text-start', picked === l.id && 'ring-2 ring-primary', clashes.length && 'ring-2 ring-destructive', highlight.includes(l.id) && 'ring-2 ring-amber-400')}
                        >
                          <bdi>{g.name}</bdi>
                        </button>
                      );
                    })}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── The side panel ──────────────────────────────────────────────────────────

function PickedPanel({
  tt, lesson, draft, hover, hoverOption, roomName, onRoom, onLock, onUnplace, onClose, pending,
}: {
  tt: Editor; lesson: EditorLesson; draft: boolean; hover: { weekday: number; period: number } | null; hoverOption: SlotOption | undefined;
  roomName: (id: string | null) => string; onRoom: (roomId: string | null) => void; onLock: (locked: boolean) => void; onUnplace: () => void; onClose: () => void; pending: boolean;
}) {
  const g = tt.groups.find((x) => x.id === lesson.groupId)!;
  const slot = lesson.weekday !== null ? `${WEEKDAY_NAMES[lesson.weekday]} ${tt.engine.days.find((d) => d.weekday === lesson.weekday)?.periods.find((p) => p.period === lesson.period)?.label ?? lesson.period}` : null;
  const now = tt.clashes.filter((c) => c.lessonIds.includes(lesson.id));
  const eg = tt.engine.groups.find((x) => x.id === g.id)!;
  const rooms = tt.engine.rooms.filter((r) => r.isActive && (!eg.roomType || r.type === eg.roomType) && eg.roomFeatures.every((f) => r.features.includes(f)) && (r.capacity === null || r.capacity >= eg.size) && (!eg.roomId || eg.roomId === r.id));
  return (
    <section aria-labelledby="picked-title" className="rounded-xl border border-primary/40 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h2 id="picked-title" className="font-display text-base font-bold text-foreground"><bdi>{g.name}</bdi></h2>
        <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground" aria-label="Put it back">✕</button>
      </div>
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex gap-2"><dt className="text-muted-foreground">Teacher:</dt><dd>{g.teacherName ? <bdi>{g.teacherName}</bdi> : 'No teacher yet'}</dd></div>
        <div className="flex gap-2"><dt className="text-muted-foreground">Students:</dt><dd className="tabular-nums">{eg.size}</dd></div>
        <div className="flex gap-2"><dt className="text-muted-foreground">Lesson:</dt><dd><bdi>{lesson.seq}</bdi> <span>of</span> <bdi>{tt.engine.lessons.filter((l) => l.groupId === g.id).length}</bdi>{lesson.length === 2 && <span> (double)</span>}</dd></div>
        <div className="flex gap-2"><dt className="text-muted-foreground">Now at:</dt><dd>{slot ? <bdi>{slot}</bdi> : 'Not on the grid'}</dd></div>
      </dl>
      {draft && lesson.weekday !== null && (
        <div className="mt-3">
          <Label htmlFor="picked-room" className="mb-1 text-xs text-muted-foreground">Room</Label>
          <select id="picked-room" className={SELECT_CLASS} value={lesson.roomId ?? ''} disabled={pending || lesson.locked} onChange={(e) => onRoom(e.target.value || null)}>
            {lesson.roomId && !rooms.some((r) => r.id === lesson.roomId) && <option value={lesson.roomId}>{roomName(lesson.roomId)}</option>}
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      )}
      {now.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-destructive">
          {now.map((c, i) => <li key={i}>{c.message}</li>)}
        </ul>
      )}
      {draft && (
        <div className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm" aria-live="polite">
          {hover && hoverOption ? (
            hoverOption.ok ? (
              <span className="font-medium text-foreground">{`${WEEKDAY_NAMES[hover.weekday]}: fits here.`}</span>
            ) : (
              <>
                <span className="font-medium text-destructive">Here it would clash:</span>
                <ul className="mt-1 list-disc ps-4 text-muted-foreground">
                  {hoverOption.reasons.map((r, i) => <li key={i}>{r.message}</li>)}
                </ul>
              </>
            )
          ) : (
            <span className="text-muted-foreground">Point at a cell to see whether it fits, and why not.</span>
          )}
        </div>
      )}
      {draft && (
        <div className="mt-3 flex flex-wrap gap-2">
          {lesson.weekday !== null && (
            <Button variant="outline" size="sm" disabled={pending} onClick={() => onLock(!lesson.locked)}>{lesson.locked ? 'Unlock' : 'Lock here'}</Button>
          )}
          {lesson.weekday !== null && !lesson.locked && (
            <Button variant="outline" size="sm" disabled={pending} onClick={onUnplace}>Take off the grid</Button>
          )}
        </div>
      )}
    </section>
  );
}

function ClashList({ clashes, onShow }: { clashes: EditorClash[]; onShow: (lessonIds: string[]) => void }) {
  return (
    <section aria-labelledby="clash-title" className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <h2 id="clash-title" className="font-display text-base font-bold text-foreground">
        Clashes <span className="font-normal text-muted-foreground">({clashes.length})</span>
      </h2>
      {clashes.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">None: nobody is in two places, and every rule holds.</p>
      ) : (
        <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto text-sm">
          {clashes.map((c, i) => (
            <li key={i}>
              <button type="button" onClick={() => onShow(c.lessonIds)} className="text-start text-destructive underline-offset-2 hover:underline">{c.message}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── The generator ───────────────────────────────────────────────────────────

type Run = Editor['runs'][number];

function RunPanel({ tt }: { tt: Editor }) {
  const run = tt.runs[0];
  if (!run) return null;
  return <RunSummary run={run} />;
}

function RunSummary({ run }: { run: Run }) {
  const m = run.measures as { construction?: Record<string, number>; final?: Record<string, number> };
  const rows: [string, string][] = [
    ['sameDayRepeats', 'Same-day repeats'],
    ['teacherGaps', 'Teacher gaps'],
    ['teacherDaySpread', 'Uneven teacher days'],
    ['studentDaySpread', 'Uneven student days (average)'],
  ];
  return (
    <section aria-labelledby="run-title" className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <h2 id="run-title" className="font-display text-base font-bold text-foreground">Last generation</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {run.outcome === 'applied' ? (
          <>
            <span>Placed</span> <bdi className="tabular-nums">{run.placed}</bdi> <span>of</span> <bdi className="tabular-nums">{run.lessons}</bdi>{' '}
            <span>lessons in</span> <bdi className="tabular-nums">{(run.durationMs / 1000).toFixed(1)}</bdi> <span>s</span>
            {run.locked > 0 && (<>{' · '}<bdi className="tabular-nums">{run.locked}</bdi> <span>kept where they were locked</span></>)}
          </>
        ) : (
          <span>Not written: the timetable changed while it ran.</span>
        )}
      </p>
      {m.construction && m.final && (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="text-start font-medium">Measure</th>
              <th className="text-end font-medium">First pass</th>
              <th className="text-end font-medium">Final</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, label]) => (
              <tr key={k}>
                <td>{label}</td>
                <td className="text-end tabular-nums">{m.construction![k]}</td>
                <td className="text-end font-semibold tabular-nums">{m.final![k]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {run.explanations.length > 0 && (
        <div className="mt-3">
          <h3 className="text-sm font-semibold text-foreground">Could not be placed</h3>
          <ul className="mt-1 space-y-2 text-sm">
            {run.explanations.map((e) => (
              <li key={e.lessonId} className="rounded-lg bg-muted px-3 py-2">
                <p className="font-medium text-foreground"><bdi>{e.groupName}</bdi>, <span>lesson</span> <bdi>{e.seq}</bdi>{e.length === 2 && <span> (double)</span>}</p>
                <ul className="mt-1 list-disc ps-4 text-muted-foreground">
                  {e.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function GenerateButton({ tt, onDone }: { tt: Editor; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const gen = useMutation({
    mutationFn: async () => apiResponse(api.v1.timetables[':id'].generate.$post({ param: { id: tt.timetable.id }, json: {} })),
    onSuccess: () => onDone(),
  });
  const locked = tt.engine.lessons.filter((l) => l.locked).length;
  return (
    <>
      <Button onClick={() => setOpen(true)}>Generate</Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="gen-title">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-xl">
            <h2 id="gen-title" className="font-display text-lg font-bold text-foreground">Generate the timetable</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Every lesson that is not locked is placed again from scratch, so that no teacher, room or student is in two places and every rule holds; then it spreads each group over the week and closes teachers' gaps. The same draft always gives the same result.
            </p>
            <p className="mt-2 text-sm text-foreground">
              <bdi className="tabular-nums">{tt.engine.lessons.length - locked}</bdi> <span>lessons to place</span>
              {locked > 0 && (<>{' · '}<bdi className="tabular-nums">{locked}</bdi> <span>locked stay where they are</span></>)}
            </p>
            {gen.isError && <Notice tone="danger" className="mt-3">{gen.error instanceof Error ? gen.error.message : 'It did not run'}</Notice>}
            {gen.data && (
              <div className="mt-3">
                <Notice tone={gen.data.unplaced.length ? 'warning' : 'success'} title={gen.data.unplaced.length ? `${gen.data.unplaced.length} lessons could not be placed` : 'Every lesson has a place'}>
                  <span>Placed</span> <bdi className="tabular-nums">{gen.data.stats.placed}</bdi> <span>of</span> <bdi className="tabular-nums">{gen.data.stats.lessons}</bdi> <span>in</span>{' '}
                  <bdi className="tabular-nums">{(gen.data.durationMs / 1000).toFixed(1)}</bdi> <span>s</span>
                </Notice>
                {gen.data.unplaced.length > 0 && (
                  <ul className="mt-2 space-y-2 text-sm">
                    {gen.data.unplaced.map((u) => (
                      <li key={u.lessonId} className="rounded-lg bg-muted px-3 py-2">
                        <p className="font-medium text-foreground">{u.summary}</p>
                        {u.reasons.length > 1 && (
                          <ul className="mt-1 list-disc ps-4 text-muted-foreground">
                            {u.reasons.slice(1).map((r, i) => <li key={i}>{r}</li>)}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setOpen(false); gen.reset(); }} disabled={gen.isPending}>{gen.data ? 'Close' : 'Cancel'}</Button>
              {!gen.data && <Button onClick={() => gen.mutate()} disabled={gen.isPending}>{gen.isPending ? 'Placing lessons…' : 'Generate now'}</Button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Publishing ──────────────────────────────────────────────────────────────

function PublishButton({ tt }: { tt: Editor }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const today = schoolToday();
  const [date, setDate] = useState(tt.term.startsOn > today ? tt.term.startsOn : today);
  const [note, setNote] = useState('');
  const [acceptUnplaced, setAcceptUnplaced] = useState(false);
  const unplaced = tt.unplaced.length;
  const pub = useMutation({
    mutationFn: async () => apiResponse(api.v1.timetables[':id'].publish.$post({ param: { id: tt.timetable.id }, json: { effectiveFrom: date, note: note.trim() || null, acceptUnplaced } })),
  });
  // The editor turns read-only once published, which would take this dialog away: refresh when it is closed.
  const close = () => { setOpen(false); if (pub.isSuccess) qc.invalidateQueries({ queryKey: TT_KEY }); };
  const blocked = tt.clashes.length > 0 || (unplaced > 0 && !acceptUnplaced);
  // Once published it stays mounted only to show its confirmation.
  if (tt.timetable.status !== 'draft' && !open) return null;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Publish</Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="pub-title">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <h2 id="pub-title" className="font-display text-lg font-bold text-foreground">Publish this timetable</h2>
            {pub.data ? (
              <>
                <Notice tone="success" className="mt-3" title="Published">
                  <span>It takes effect on</span> <DateText date={pub.data.effectiveFrom} weekday long />.{' '}
                  <span>Told:</span> <bdi className="tabular-nums">{pub.data.notified.students}</bdi> <span>students,</span>{' '}
                  <bdi className="tabular-nums">{pub.data.notified.parents}</bdi> <span>parents,</span> <bdi className="tabular-nums">{pub.data.notified.teachers}</bdi> <span>teachers.</span>
                </Notice>
                <div className="mt-5 flex justify-end"><Button onClick={close}>Close</Button></div>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-muted-foreground">
                  From the date you choose, students, parents and teachers see this timetable, and the previous one stays on record for the days before. A published timetable does not change afterwards.
                </p>
                <div className="mt-4 space-y-3">
                  <div>
                    <Label htmlFor="pub-date" className="mb-1 text-sm">Takes effect on</Label>
                    <Input id="pub-date" type="date" value={date} min={today > tt.term.startsOn ? today : tt.term.startsOn} max={tt.term.endsOn} onChange={(e) => setDate(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="pub-note" className="mb-1 text-sm">Note (optional, kept with the version)</Label>
                    <Input id="pub-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
                  </div>
                  {tt.clashes.length > 0 && <Notice tone="danger">{`Resolve the ${tt.clashes.length} clashes first.`}</Notice>}
                  {unplaced > 0 && (
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-1" checked={acceptUnplaced} onChange={(e) => setAcceptUnplaced(e.target.checked)} />
                      <span>{`Publish without the ${unplaced} lessons that are not on the grid (they are not taught until a later version places them).`}</span>
                    </label>
                  )}
                  {pub.isError && <Notice tone="danger">{pub.error instanceof Error ? pub.error.message : 'It was not published'}</Notice>}
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setOpen(false)} disabled={pub.isPending}>Cancel</Button>
                  <Button onClick={() => pub.mutate()} disabled={blocked || pub.isPending}>{pub.isPending ? 'Publishing…' : 'Publish'}</Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ExportMenu({ tt }: { tt: Editor }) {
  const [err, setErr] = useState<string | null>(null);
  const id = tt.timetable.id;
  const run = (what: 'asc' | 'fet' | 'csv') => async () => {
    setErr(null);
    try {
      if (what === 'asc') await download(await api.v1.timetables[':id'].export.asc.$get({ param: { id } }), 'timetable.xml');
      if (what === 'fet') await download(await api.v1.timetables[':id'].export.fet.$get({ param: { id } }), 'timetable.fet');
      if (what === 'csv') await download(await api.v1.timetables[':id'].export.csv.$get({ param: { id }, query: {} }), 'timetable.csv');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The file could not be made');
    }
  };
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Export">
      <Button variant="outline" size="sm" onClick={run('csv')} title="One row per lesson, for a spreadsheet">CSV</Button>
      <Button variant="outline" size="sm" onClick={run('asc')} title="aSc Timetables XML import">aSc XML</Button>
      <Button variant="outline" size="sm" onClick={run('fet')} title="FET, the free timetabler (.fet)">FET</Button>
      {err && <span className="text-xs text-destructive">{err}</span>}
    </div>
  );
}

function ConfirmClash({ tt, confirm, pending, onCancel, onPlace }: { tt: Editor; confirm: { lessonId: string; weekday: number; period: number; option: SlotOption }; pending: boolean; onCancel: () => void; onPlace: () => void }) {
  const l = tt.engine.lessons.find((x) => x.id === confirm.lessonId)!;
  const g = tt.groups.find((x) => x.id === l.groupId)!;
  const label = tt.engine.days.find((d) => d.weekday === confirm.weekday)?.periods.find((p) => p.period === confirm.period)?.label ?? String(confirm.period);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="clash-confirm-title">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
        <h2 id="clash-confirm-title" className="font-display text-lg font-bold text-foreground">
          <bdi>{g.name}</bdi> <span>at</span> <bdi>{`${WEEKDAY_NAMES[confirm.weekday]} ${label}`}</bdi> <span>would clash</span>
        </h2>
        <ul className="mt-3 list-disc space-y-1 ps-5 text-sm text-destructive">
          {confirm.option.reasons.map((r, i) => <li key={i}>{r.message}</li>)}
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">You can place it anyway while you rearrange; the clash stays listed and the timetable cannot be published until it is resolved.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={pending}>Leave it where it was</Button>
          <Button variant="destructive" onClick={onPlace} disabled={pending}>Place anyway</Button>
        </div>
      </div>
    </div>
  );
}
