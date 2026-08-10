'use client';

/**
 * Results Entry Client — Staff (V3 §5.4)
 *
 * Session picker → grid of confirmed registrations → inline grade
 * inputs → one save. Existing grades prefill (re-recording fixes typos).
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { toCsv, downloadCsv } from '~/lib/csv';

type SessionRow = { id: string; name: string; status: string };
type PendingRow = {
  id: string;
  gradeReceived: string | null;
  student: { id: string; name: string; studentId: string | null; grade: number | null };
  subject: { id: string; name: string; code: string; council: string };
};

export default function ResultsEntryClient(): React.JSX.Element {
  const qc = useQueryClient();
  const [sessionId, setSessionId] = useState('');
  const [grades, setGrades] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [search, setSearch] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const { data: sessions = [] } = useQuery<SessionRow[]>({
    queryKey: ['sessions', 'all-admin'],
    queryFn: async () => (await apiResponse(api.v1.sessions.$get({ query: {} }))) as SessionRow[],
  });

  const { data: rows = [], isFetching } = useQuery<PendingRow[]>({
    queryKey: ['results', 'pending', sessionId],
    queryFn: async () =>
      (await apiResponse(
        api.v1.remarks.results.pending.$get({ query: { sessionId } })
      )) as PendingRow[],
    enabled: !!sessionId,
  });

  // Prefill entered grades when rows load
  useEffect(() => {
    if (rows.length === 0) return;
    setGrades((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (next[r.id] === undefined && r.gradeReceived) next[r.id] = r.gradeReceived;
      }
      return next;
    });
  }, [rows]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const results = rows
        .filter((r) => (grades[r.id] ?? '').trim() && (grades[r.id] ?? '').trim() !== (r.gradeReceived ?? ''))
        .map((r) => ({ registrationId: r.id, grade: grades[r.id]!.trim() }));
      return apiResponse(api.v1.remarks.results.$post({ json: { results } }));
    },
    onSuccess: (data) => {
      const d = data as unknown as { recorded: number; skipped: number };
      setMessage(`Saved ${d.recorded} grade(s)${d.skipped ? ` (${d.skipped} skipped)` : ''}.`);
      setErrorMsg('');
      qc.invalidateQueries({ queryKey: ['results'] });
    },
    onError: (err: Error) => { setErrorMsg(err.message); setMessage(''); },
  });

  const changedCount = rows.filter(
    (r) => (grades[r.id] ?? '').trim() && (grades[r.id] ?? '').trim() !== (r.gradeReceived ?? '')
  ).length;

  // Paste-from-Excel (UX_AUDIT G10): "studentId <tab/,> subjectCode <tab/,> grade"
  function applyPaste() {
    const lines = pasteText.split('\n').map((l) => l.trim()).filter(Boolean);
    let matched = 0;
    const misses: string[] = [];
    const next = { ...grades };
    for (const line of lines) {
      const cells = line.split(/[,;\t]/).map((c) => c.trim());
      if (cells.length < 3) { misses.push(line); continue; }
      const [who, code, grade] = cells;
      const key = (who ?? '').trim().toLowerCase();
      // The school's own spreadsheet has NAMES, not system-generated
      // student IDs, so matching on studentId alone only worked for a
      // sheet exported from this system. Match on ID, then name.
      const matches = rows.filter((r) => {
        if (r.subject.code.toLowerCase() !== (code ?? '').toLowerCase()) return false;
        return (
          (r.student.studentId ?? '').toLowerCase() === key ||
          r.student.name.trim().toLowerCase() === key
        );
      });
      if (matches.length > 1) {
        misses.push(`${line}  (matches ${matches.length} students — use the student ID)`);
        continue;
      }
      const row = matches[0];
      if (row && grade) {
        next[row.id] = grade.toUpperCase();
        matched++;
      } else {
        misses.push(line);
      }
    }
    setGrades(next);
    setMessage(`Matched ${matched} row(s) from paste${misses.length ? ` — ${misses.length} not matched` : ''}. Review and Save.`);
    if (misses.length === 0) { setPasteText(''); setShowPaste(false); }
  }

  const visible = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.student.name.toLowerCase().includes(q) ||
      (r.student.studentId ?? '').toLowerCase().includes(q) ||
      r.subject.name.toLowerCase().includes(q) ||
      r.subject.code.toLowerCase().includes(q)
    );
  });

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto animate-fade-up">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">Results Entry</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pick a session, type grades, save. Existing grades prefill — retype to correct.
        </p>
      </div>

      <div className="flex gap-3 flex-wrap mb-6">
        <select
          value={sessionId}
          onChange={(e) => { setSessionId(e.target.value); setGrades({}); setMessage(''); }}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
        >
          <option value="">Pick a session…</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.status})</option>
          ))}
        </select>
        {sessionId && (
          <Button variant="outline" onClick={() => setShowPaste((v) => !v)}>
            {showPaste ? 'Close Paste' : 'Paste from Excel'}
          </Button>
        )}
        {sessionId && rows.length > 0 && (
          <Button
            variant="outline"
            onClick={() =>
              downloadCsv(
                'results-template.csv',
                toCsv(
                  ['studentId', 'studentName', 'subjectCode', 'grade'],
                  rows.map((r) => [
                    r.student.studentId ?? '',
                    r.student.name,
                    r.subject.code,
                    r.gradeReceived ?? '',
                  ])
                )
              )
            }
          >
            Export Grid
          </Button>
        )}
        {sessionId && (
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by student or subject…"
            className="flex-1 min-w-[220px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          />
        )}
      </div>

      {showPaste && sessionId && (
        <div className="mb-4 bg-card rounded-xl border border-border shadow-sm p-4">
          <p className="text-xs text-muted-foreground mb-2">
            Paste rows as <span className="font-mono">student name (or ID), subjectCode, grade</span>{' '}
            — tab or comma separated, straight from the results spreadsheet. Rows fill the grid
            below; nothing saves until you click Save. Use the student ID if two students share a name.
          </p>
          <textarea
            rows={5}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'Ahmed Hassan\t4MB1\tA*\nSTU-20260901-9K2LM\t0610\t7'}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground font-mono"
          />
          <div className="mt-2 flex justify-end">
            <Button size="sm" disabled={!pasteText.trim()} onClick={applyPaste}>Fill Grid</Button>
          </div>
        </div>
      )}

      {message && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400">
          {message}
        </div>
      )}
      {errorMsg && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-sm text-destructive">
          {errorMsg}
        </div>
      )}

      {!sessionId ? null : isFetching ? (
        <div className="flex justify-center py-10">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center shadow-sm">
          <p className="text-muted-foreground text-sm">No confirmed registrations in this session.</p>
        </div>
      ) : (
        <>
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden mb-4">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border bg-muted">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Student</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Subject</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground w-32">Grade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-2">
                      <div className="font-medium text-foreground">{r.student.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{r.student.studentId ?? ''}</div>
                    </td>
                    <td className="px-4 py-2 text-card-foreground">
                      {r.subject.name}
                      <span className="text-xs text-muted-foreground font-mono ml-1">{r.subject.code}</span>
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={grades[r.id] ?? ''}
                        onChange={(e) => setGrades((prev) => ({ ...prev, [r.id]: e.target.value.toUpperCase() }))}
                        placeholder="A* / 7 / B…"
                        className={`w-24 rounded-lg border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground font-mono ${
                          (grades[r.id] ?? '').trim() && (grades[r.id] ?? '').trim() !== (r.gradeReceived ?? '')
                            ? 'border-primary'
                            : 'border-border'
                        }`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <Button
              disabled={saveMutation.isPending || changedCount === 0}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? 'Saving…' : `Save ${changedCount} Grade${changedCount === 1 ? '' : 's'}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
