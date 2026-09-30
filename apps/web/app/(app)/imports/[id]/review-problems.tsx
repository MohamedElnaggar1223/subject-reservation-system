'use client';

/**
 * Problems: every kind the file has, errors first — its title, the spike
 * finding it answers (IS-nn), how many rows or people it touches, what it
 * means and what to do, and the first rows with a "Fix" beside each. The
 * school's sheet had all of these; the review found them so nobody has to.
 */

import { useMemo, useState } from 'react';
import { COUNCIL_LABELS, type Council } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/tone';
import { EmptyState } from '~/components/ui/query-state';
import { SEVERITY, SeverityDot, problemTitle, problemMeaning, problemFinding, LineRef, Who, rowSummary, type ImportView } from '../import-shared';

type Group = { code: string; severity: string; rows: ImportView['rows']; people: ImportView['people']; series: ImportView['mapping']['series'] };

export function ProblemsTab({ v, onOpenRows, onEdit }: { v: ImportView; onOpenRows: (code: string) => void; onEdit: (rowId: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = useMemo(() => {
    const by = new Map<string, Group>();
    const at = (code: string, severity: string) => {
      const g = by.get(code) ?? { code, severity, rows: [], people: [], series: [] };
      if (SEVERITY[severity]!.order < SEVERITY[g.severity]!.order) g.severity = severity;
      by.set(code, g);
      return g;
    };
    for (const r of v.rows) {
      if (r.status === 'committed') continue;
      for (const p of r.problems) at(p.code, p.severity).rows.push(r);
    }
    for (const p of v.people) {
      if (p.mergedInto || p.status === 'committed') continue;
      for (const pr of p.problems) {
        const g = at(pr.code, pr.severity);
        if (!g.people.includes(p)) g.people.push(p);
      }
    }
    for (const s of v.mapping.series) for (const pr of s.problems) at(pr.code, pr.severity).series.push(s);
    return [...by.values()].sort((a, b) => SEVERITY[a.severity]!.order - SEVERITY[b.severity]!.order || (b.rows.length + b.people.length) - (a.rows.length + a.people.length));
  }, [v]);

  if (!groups.length) return <EmptyState title="No problems" message="Every row reads cleanly. Check the mapping, then commit." />;

  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const isOpen = open === g.code;
        const finding = problemFinding(g.code);
        const count = g.rows.length || g.people.length || g.series.length;
        const unit = g.rows.length ? (count === 1 ? 'row' : 'rows') : g.people.length ? (count === 1 ? 'person' : 'people') : count === 1 ? 'series' : 'series';
        return (
          <section key={g.code} className="rounded-xl border border-border bg-card shadow-sm">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : g.code)}
              className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-start"
            >
              <SeverityDot severity={g.severity} />
              <span className="font-semibold text-foreground">{problemTitle(g.code)}</span>
              {finding && <Badge tone="neutral">{finding}</Badge>}
              <Badge tone={SEVERITY[g.severity]!.tone}>{SEVERITY[g.severity]!.label}</Badge>
              <span className="ms-auto text-sm text-muted-foreground"><span className="tabular-nums font-semibold text-foreground">{count}</span> <span>{unit}</span></span>
            </button>
            {isOpen && (
              <div className="border-t border-border px-4 py-3">
                <p className="text-sm text-muted-foreground">{problemMeaning(g.code)}</p>
                {g.rows.length > 0 && (
                  <>
                    <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
                      {g.rows.slice(0, 8).map((r) => {
                        const s = rowSummary(r);
                        const p = r.problems.find((x) => x.code === g.code);
                        return (
                          <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                            <span className="w-28 shrink-0"><LineRef r={r} /></span>
                            <span className="w-56 min-w-0"><Who name={s.student} email={s.email} /></span>
                            <bdi data-i18n-skip="true" className="min-w-0 flex-1 truncate text-muted-foreground">{[s.subject, s.code].filter(Boolean).join(' · ')}</bdi>
                            {p?.detail && <bdi className="text-xs text-muted-foreground">{p.detail}</bdi>}
                            <Button size="sm" variant="outline" onClick={() => onEdit(r.id)}>Fix</Button>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="mt-2 flex items-center gap-3">
                      <Button size="sm" variant="ghost" onClick={() => onOpenRows(g.code)}>
                        {g.rows.length > 8 ? <><span>Show all</span> <span className="tabular-nums">{g.rows.length}</span> <span>rows</span></> : 'Show these rows'}
                      </Button>
                    </div>
                  </>
                )}
                {g.rows.length === 0 && g.people.length > 0 && (
                  <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
                    {g.people.slice(0, 8).map((p) => (
                      <li key={`${p.role}|${p.key}`} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                        <Badge tone="neutral">{p.role === 'student' ? 'Student' : 'Parent'}</Badge>
                        <span className="w-64 min-w-0"><Who name={p.name} email={p.email} /></span>
                        <bdi className="text-xs text-muted-foreground">{p.problems.find((x) => x.code === g.code)?.detail}</bdi>
                      </li>
                    ))}
                    <li className="px-3 py-2 text-xs text-muted-foreground">Settle these on the People and conflicts tab.</li>
                  </ul>
                )}
                {g.series.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm">
                    {g.series.map((s) => (
                      <li key={s.key}><bdi data-i18n-skip="true">{s.label}</bdi> <span className="text-muted-foreground">·</span> <span>{s.level === 'igcse' ? 'IGCSE' : s.level === 'as_level' ? 'AS Level' : 'A Level'}</span> <span className="text-muted-foreground">—</span> <bdi data-i18n-skip="true" className="text-muted-foreground">{s.boards.map((b) => COUNCIL_LABELS[b as Council] ?? b).join(', ')}</bdi></li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
