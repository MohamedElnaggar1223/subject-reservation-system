'use client';

/**
 * Mapping: what the file's words become in the system, one screen of
 * choices, each defaulting to today's assumption.
 * - Tabs: which to take, and the year their classes are in.
 * - Series and levels: history (default), or registrations awaiting payment
 *   in an open window of the same series (the admin's), or leave out.
 * - Subjects: the catalogue row each of the sheet's subjects is (found by
 *   name, code or unit), or added in one step by the admin.
 * - Teachers, sections, and the coordinator's pending answers (decision 3):
 *   self-study on a taught subject, "carry forward", graduates; and how many
 *   rows each reading of "A.S./A.2." agrees with.
 */

import { useState } from 'react';
import { api } from '~/lib/hono';
import {
  apiResponse, COUNCIL_LABELS, SELF_STUDY_RULES, SELF_STUDY_RULE_LABELS, CARRY_FORWARD_READINGS, CARRY_FORWARD_LABELS, LEVEL_CODE_READING_LABELS,
  academicYearShortLabel, type Council, type LevelCodeReading, type ImportSettingsType,
} from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { LEVEL_LABEL, SELECT, INPUT, problemTitle, type ImportView } from '../import-shared';
import { useReviewMutation } from './review.client';

const councilName = (c: string) => COUNCIL_LABELS[c as Council] ?? c;

export function MappingTab({ id, v, editable, isAdmin }: { id: string; v: ImportView; editable: boolean; isAdmin: boolean }) {
  const set = useReviewMutation(id, (json: ImportSettingsType) => apiResponse(api.v1.imports[':id'].settings.$put({ param: { id }, json })));
  const s = v.settings;
  const disabled = !editable || set.isPending;
  const years = v.options.years;

  return (
    <div className="space-y-6">
      {set.error && <Notice tone="danger">{set.error}</Notice>}

      {v.kind === 'school_sheet' && (
        <Section title="The file's tabs" hint="Each tab is read by its own headers. Its classes and grades are those of one academic year: the year of the tab's main series.">
          <ul className="divide-y divide-border">
            {v.mapping.tabs.map((t) => (
              <li key={t.name} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <bdi data-i18n-skip="true" className="w-32 font-medium text-foreground">{t.name}</bdi>
                {t.kind === 'session' ? (
                  <>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={t.include} disabled={disabled} onChange={(e) => set.mutate({ tabs: { [t.name]: { include: e.target.checked, classYear: t.classYear! } } })} />
                      <span>Import it</span>
                    </label>
                    <span className="text-muted-foreground"><span className="tabular-nums">{t.lines}</span> <span>lines</span>{t.mainSeries && <> · <span>{t.mainSeries}</span></>}</span>
                    <label className="flex items-center gap-2">
                      <span className="text-muted-foreground">Classes are in</span>
                      <select className={SELECT} disabled={disabled} value={t.classYear ?? ''} onChange={(e) => set.mutate({ tabs: { [t.name]: { include: t.include, classYear: Number(e.target.value) } } })}>
                        {[...new Set([...(t.classYear ? [t.classYear] : []), ...years.map((y) => y.startYear)])].sort().map((y) => (
                          <option key={y} value={y}>{academicYearShortLabel(y)}{years.some((x) => x.startYear === y) ? '' : ' (not set up)'}</option>
                        ))}
                      </select>
                    </label>
                    {!t.yearSetUp && <Badge tone="warning">Year not set up: no sections or enrolments</Badge>}
                  </>
                ) : (
                  <span className="text-muted-foreground">{t.kind === 'roster' ? 'A per-unit class list without emails — not imported' : 'Not a registration tab — not imported'}</span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {v.kind === 'scl_roster' && (
        <Section title="Whose grades" hint="The grade column is each student's grade in one academic year; 9 means they start grade 10 the year after.">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">The grades in this file are those of</span>
            <select className={SELECT} disabled={disabled} value={s.gradeYear} onChange={(e) => set.mutate({ gradeYear: Number(e.target.value) })}>
              {[...new Set([s.gradeYear, ...years.map((y) => y.startYear)])].sort().map((y) => <option key={y} value={y}>{academicYearShortLabel(y)}</option>)}
            </select>
          </label>
        </Section>
      )}

      {v.kind === 'school_sheet' && v.mapping.series.length > 0 && (
        <Section title="Series and levels" hint="History records what each student registered for before the system; nothing is owed. An open window of the same series takes the rows as registrations awaiting payment — the family then pays through the app or the desk. That choice is the admin's.">
          <ul className="divide-y divide-border">
            {v.mapping.series.map((g) => (
              <li key={g.key} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="w-56">
                  <span className="font-medium text-foreground">{g.label}</span> <span className="text-muted-foreground">·</span> <span>{LEVEL_LABEL[g.level] ?? g.level}</span>
                  <span className="block text-xs text-muted-foreground"><span>academic year</span> <span>{g.academicYear}</span> · <span className="tabular-nums">{g.rows}</span> <span>lines</span></span>
                </span>
                <select
                  aria-label={`What ${g.label} becomes`}
                  className={cn(SELECT, 'min-w-72')}
                  disabled={disabled}
                  value={g.mode === 'window' ? `window:${g.sessionId ?? ''}` : g.mode}
                  onChange={(e) => {
                    const val = e.target.value;
                    set.mutate({ series: { [g.key]: val.startsWith('window:') ? { mode: 'window', sessionId: val.slice(7) } : { mode: val as 'history' | 'skip', sessionId: null } } });
                  }}
                >
                  <option value="history">History only</option>
                  {g.windows.map((w) => (
                    <option key={w.id} value={`window:${w.id}`} disabled={!isAdmin || w.status !== 'active'}>
                      {`Registrations awaiting payment in ${w.name}${w.status !== 'active' ? ` (${w.status})` : ''}`}
                    </option>
                  ))}
                  <option value="skip">Leave these rows out</option>
                </select>
                {g.suggestedWindowId && g.mode !== 'window' && <Badge tone="info">An open window matches{isAdmin ? '' : ' — the admin can register these'}</Badge>}
                {g.windows.length === 0 && <span className="text-xs text-muted-foreground">No window of this series and level.</span>}
                {g.boards.length > 0 && <span className="text-xs text-muted-foreground"><span>Boards:</span> <bdi data-i18n-skip="true">{g.boards.map(councilName).join(', ')}</bdi></span>}
                {g.problems.map((p) => <Badge key={p.code} tone="info">{problemTitle(p.code)}</Badge>)}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {v.kind === 'school_sheet' && <SubjectsSection id={id} v={v} disabled={disabled} isAdmin={isAdmin} onMap={(key, subjectId) => set.mutate({ subjects: { [key]: { subjectId } } })} />}

      {v.kind === 'school_sheet' && v.mapping.teachers.length > 0 && (
        <Section title="Teachers" hint="The sheet names a teacher per row. Each name becomes a teacher record (made when you commit) or an existing one; a teacher named on an enrolment is linked to its subject.">
          <ul className="grid gap-2 md:grid-cols-2">
            {v.mapping.teachers.map((t) => (
              <li key={t.key} className="flex items-center gap-2 text-sm">
                <bdi data-i18n-skip="true" className="w-36 truncate font-medium">{t.name}</bdi>
                <span className="text-xs text-muted-foreground">(<span className="tabular-nums">{t.rows}</span>)</span>
                <select
                  aria-label={`Teacher record for ${t.name}`}
                  className={cn(SELECT, 'flex-1')}
                  disabled={disabled}
                  value={t.teacherId ?? (t.create ? '__new__' : '__none__')}
                  onChange={(e) => {
                    const val = e.target.value;
                    set.mutate({ teachers: { [t.key]: val === '__new__' ? { teacherId: null, create: true } : val === '__none__' ? { teacherId: null, create: false } : { teacherId: val, create: false } } });
                  }}
                >
                  <option value="__new__">A new teacher record</option>
                  <option value="__none__">No teacher</option>
                  {[...v.options.teachers].sort((a, b) => Number(t.candidates.includes(b.id)) - Number(t.candidates.includes(a.id)) || a.name.localeCompare(b.name)).map((x) => (
                    <option key={x.id} value={x.id}>{x.name}{x.isActive ? '' : ' (inactive)'}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {v.mapping.sections.length > 0 && (
        <Section title="Sections" hint="Students are placed in the section their class names, in its academic year. A student already in another section that year stays where they are (flagged).">
          <label className="mb-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={s.createSections} disabled={disabled} onChange={(e) => set.mutate({ createSections: e.target.checked })} />
            <span>Make the sections the file names that do not exist yet</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {v.mapping.sections.map((x) => (
              <span key={`${x.year}|${x.name}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-sm">
                <bdi data-i18n-skip="true" className="font-medium">{x.name}</bdi>
                <span className="text-xs text-muted-foreground">{x.yearLabel}</span>
                <span className="text-xs text-muted-foreground">· <span className="tabular-nums">{x.students}</span></span>
                {!x.yearSetUp ? <Badge tone="warning">Year not set up</Badge> : x.exists ? <Badge tone="neutral">Exists</Badge> : <Badge tone="info">New</Badge>}
              </span>
            ))}
          </div>
        </Section>
      )}

      {v.kind === 'school_sheet' && (
        <Section title="The coordinator's pending answers" hint="Each starts from the school's own answer on the Settings page (today's assumption until the coordinator answers). Changing it here changes only this file.">
          <Choice
            legend="Self-study on a subject the school teaches (IS-03)"
            value={s.selfStudyOnTaught}
            options={SELF_STUDY_RULES.map((r) => [r, SELF_STUDY_RULE_LABELS[r]])}
            disabled={disabled}
            onChange={(val) => set.mutate({ selfStudyOnTaught: val as ImportSettingsType['selfStudyOnTaught'] })}
          />
          <Choice
            legend={'What "Carry forward on …" means (IS-02)'}
            value={s.carryForward}
            options={CARRY_FORWARD_READINGS.map((r) => [r, CARRY_FORWARD_LABELS[r]])}
            disabled={disabled}
            onChange={(val) => set.mutate({ carryForward: val as ImportSettingsType['carryForward'] })}
          />
          <Choice
            legend="Students who have finished grade 12 by now"
            value={s.graduates}
            options={[['import', 'Import them with their history'], ['skip', 'Leave the graduates out']]}
            disabled={disabled}
            onChange={(val) => set.mutate({ graduates: val as 'import' | 'skip' })}
          />
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={s.enrol} disabled={disabled} onChange={(e) => set.mutate({ enrol: e.target.checked })} />
            <span>Enrol each student in the subjects of the year their classes are in (course enrolment)</span>
          </label>
          <p className="mt-2 text-xs text-muted-foreground"><a className="underline" href="/settings">Change the school's defaults on Settings</a></p>
        </Section>
      )}

      {v.kind === 'school_sheet' && v.mapping.levelCodes.byReading.student_series.total > 0 && (
        <Section title={'What "A.S./A.2." marks (IS-01)'} hint="The system works each row's code out from its units and the student's year; the school writes it by hand. How many rows each reading agrees with, as the coordinator's answer is awaited:">
          <table className="text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr><th className="pe-4 text-start font-semibold">Reading</th><th className="pe-4 text-end font-semibold">Rows that agree</th><th className="text-end font-semibold">Of the "A.S./A.2." rows</th></tr>
            </thead>
            <tbody>
              {(Object.entries(v.mapping.levelCodes.byReading) as [LevelCodeReading, { agree: number; total: number; combined: number; combinedAgree: number }][]).map(([r, c]) => (
                <tr key={r} className={cn(r === v.mapping.levelCodes.current && 'font-semibold')}>
                  <td className="py-1 pe-4">{LEVEL_CODE_READING_LABELS[r]}{r === v.mapping.levelCodes.current && <> <Badge tone="info">Current</Badge></>}</td>
                  <td className="py-1 pe-4 text-end tabular-nums">{c.agree} / {c.total}</td>
                  <td className="py-1 text-end tabular-nums">{c.combinedAgree} / {c.combined}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground"><a className="underline" href="/settings">The reading is a school setting</a></p>
        </Section>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <h2 className="font-semibold text-foreground">{title}</h2>
      {hint && <p className="mb-3 mt-0.5 max-w-4xl text-sm text-muted-foreground">{hint}</p>}
      {children}
    </section>
  );
}

function Choice({ legend, value, options, disabled, onChange }: { legend: string; value: string; options: [string, string][]; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <fieldset className="mb-3">
      <legend className="mb-1 text-sm font-medium text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([val, label]) => (
          <label key={val} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm', value === val ? 'border-primary bg-primary/5' : 'border-border')}>
            <input type="radio" checked={value === val} disabled={disabled} onChange={() => onChange(val)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ─── Subjects: the catalogue row each of the sheet's subjects is ─────────────

function SubjectsSection({ id, v, disabled, isAdmin, onMap }: { id: string; v: ImportView; disabled: boolean; isAdmin: boolean; onMap: (key: string, subjectId: string | null) => void }) {
  const [adding, setAdding] = useState(false);
  const missing = v.mapping.subjects.filter((x) => !x.subjectId);
  const byId = new Map(v.options.subjects.map((x) => [x.id, x]));
  return (
    <Section title="Subjects" hint="Each subject as the sheet writes it, with its level code, is a registrable row of the catalogue — a whole subject, a unit (P1) or a paper set. Found by name, code or unit; check each. A subject left unmapped is kept in history in the sheet's words, with no enrolment or registration.">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="py-2 pe-3 text-start font-semibold">In the sheet</th>
              <th className="py-2 pe-3 text-end font-semibold">Rows</th>
              <th className="py-2 pe-3 text-start font-semibold">Catalogue row</th>
              <th className="py-2 text-start font-semibold">Board</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {v.mapping.subjects.map((x) => {
              const chosen = x.subjectId ? byId.get(x.subjectId) : undefined;
              const options = [...v.options.subjects].sort((a, b) =>
                Number(b.qualificationLevel === x.levelSuggested) - Number(a.qualificationLevel === x.levelSuggested) || Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name));
              return (
                <tr key={x.key} className={cn(!x.subjectId && 'bg-amber-50/60 dark:bg-amber-900/10')}>
                  <td className="py-1.5 pe-3">
                    <bdi data-i18n-skip="true" className="font-medium">{x.subject}</bdi> <bdi data-i18n-skip="true" className="text-muted-foreground">{x.levelCode}</bdi>
                    {x.isUnit && <> <Badge tone="neutral">Unit or paper</Badge></>}
                  </td>
                  <td className="py-1.5 pe-3 text-end tabular-nums">{x.rows}</td>
                  <td className="py-1.5 pe-3">
                    <select aria-label={`Catalogue row for ${x.subject} ${x.levelCode ?? ''}`} className={cn(SELECT, 'w-full min-w-64')} disabled={disabled} value={x.subjectId ?? ''} onChange={(e) => onMap(x.key, e.target.value || null)}>
                      <option value="">Not in the catalogue (history keeps the sheet's words)</option>
                      {options.map((o) => (
                        <option key={o.id} value={o.id}>{`${o.name} (${o.code}) · ${LEVEL_LABEL[o.qualificationLevel] ?? o.qualificationLevel}${o.isActive ? '' : ' · retired'}`}</option>
                      ))}
                    </select>
                    {x.subjectId && x.subjectId === x.suggestedId && !x.chosenByStaff && <span className="text-xs text-muted-foreground">Found by name</span>}
                  </td>
                  <td className="py-1.5 text-muted-foreground"><bdi data-i18n-skip="true">{chosen ? councilName(chosen.council) : '—'}</bdi></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {missing.length > 0 && (
        isAdmin ? (
          adding ? <AddSubjects id={id} v={v} rows={missing} onDone={() => setAdding(false)} /> : (
            <Button className="mt-3" variant="outline" disabled={disabled} onClick={() => setAdding(true)}>
              <span>Add the</span> <span className="tabular-nums">{missing.length}</span> <span>missing subjects to the catalogue</span>
            </Button>
          )
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Subjects carry their prices: the admin adds the missing ones from this screen, or on the Subjects page.</p>
        )
      )}
    </Section>
  );
}

/** Today's assumption for a subject's board (IS-14, DISCOVERY_RESEARCH.md §1): IAL units and paper sets Pearson Edexcel; the rest Cambridge. */
const boardFor = (x: { isUnit: boolean }) => (x.isUnit ? 'pearson_edexcel' : 'cambridge');
const codeFor = (subject: string, levelCode: string | null) =>
  `${subject.replace(/\(([^)]*)\)/g, ' $1 ').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).map((w) => (/^[A-Z]?\d+$/i.test(w) ? w.toUpperCase() : w.slice(0, 3).toUpperCase())).join('-')}-${(levelCode ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase()}`.slice(0, 40);

function AddSubjects({ id, v, rows, onDone }: { id: string; v: ImportView; rows: ImportView['mapping']['subjects']; onDone: () => void }) {
  const [items, setItems] = useState(() => rows.map((x) => ({
    key: x.key, name: x.subject, code: codeFor(x.subject, x.levelCode), qualificationLevel: (x.levelSuggested ?? 'igcse') as 'igcse' | 'as_level' | 'a_level',
    council: boardFor(x) as Council, isOfferedAtSchool: x.taughtInSchool, courseFee: 0, registrationFee: 0, include: true,
  })));
  const add = useReviewMutation(id, () => apiResponse(api.v1.imports[':id'].subjects.$post({
    param: { id }, json: { subjects: items.filter((x) => x.include).map(({ include: _i, ...x }) => x) },
  })));
  const upd = (i: number, patch: Partial<(typeof items)[number]>) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const noPrice = items.filter((x) => x.include && x.courseFee + x.registrationFee === 0).length;
  void v;
  return (
    <div className="mt-3 rounded-lg border border-border p-3">
      <p className="mb-2 text-sm text-muted-foreground">
        Each becomes a registrable row of the catalogue. The board is today's assumption (units and paper sets: Pearson Edexcel IAL; the rest: Cambridge) — change it here or later on the Catalogue. A subject with no price is added inactive: the rows keep it as history, and no one can enrol in it or register for it until the admin sets its fees and turns it on, on Subjects.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="pe-2 text-start font-semibold"><span className="sr-only">Add</span></th>
              <th className="pe-2 text-start font-semibold">Name</th>
              <th className="pe-2 text-start font-semibold">Code</th>
              <th className="pe-2 text-start font-semibold">Level</th>
              <th className="pe-2 text-start font-semibold">Board</th>
              <th className="pe-2 text-start font-semibold">Taught</th>
              <th className="pe-2 text-start font-semibold">Course fee</th>
              <th className="text-start font-semibold">Board fee</th>
            </tr>
          </thead>
          <tbody>
            {items.map((x, i) => (
              <tr key={x.key}>
                <td className="py-1 pe-2"><input type="checkbox" aria-label={`Add ${x.name}`} checked={x.include} onChange={(e) => upd(i, { include: e.target.checked })} /></td>
                <td className="py-1 pe-2"><input dir="auto" data-i18n-skip="true" className={cn(INPUT, 'min-w-48')} value={x.name} onChange={(e) => upd(i, { name: e.target.value })} /></td>
                <td className="py-1 pe-2"><input dir="ltr" data-i18n-skip="true" className={cn(INPUT, 'w-40 font-mono')} value={x.code} onChange={(e) => upd(i, { code: e.target.value })} /></td>
                <td className="py-1 pe-2">
                  <select className={SELECT} value={x.qualificationLevel} onChange={(e) => upd(i, { qualificationLevel: e.target.value as 'igcse' })}>
                    {Object.entries(LEVEL_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </td>
                <td className="py-1 pe-2">
                  <select className={SELECT} value={x.council} onChange={(e) => upd(i, { council: e.target.value as Council })}>
                    {Object.entries(COUNCIL_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </td>
                <td className="py-1 pe-2"><input type="checkbox" aria-label={`${x.name} is taught at school`} checked={x.isOfferedAtSchool} onChange={(e) => upd(i, { isOfferedAtSchool: e.target.checked })} /></td>
                <td className="py-1 pe-2"><input inputMode="decimal" className={cn(INPUT, 'w-24')} value={x.courseFee} onChange={(e) => upd(i, { courseFee: Number(e.target.value) || 0 })} /></td>
                <td className="py-1"><input inputMode="decimal" className={cn(INPUT, 'w-24')} value={x.registrationFee} onChange={(e) => upd(i, { registrationFee: Number(e.target.value) || 0 })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {noPrice > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400"><span className="tabular-nums">{noPrice}</span> <span>of them have no price yet: they are added inactive.</span></p>}
      {add.error && <Notice tone="danger" className="mt-2">{add.error}</Notice>}
      <div className="mt-3 flex gap-2">
        <Button disabled={add.isPending || !items.some((x) => x.include)} onClick={() => add.mutate(undefined, { onSuccess: onDone })}>
          {add.isPending ? 'Adding…' : 'Add them and map the rows'}
        </Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}
