'use client';

/**
 * Check these: registrations the F0b migration entered with a board it
 * inferred. Their subject's board did not sit the window's month (the
 * school's January and October rows were all "Cambridge", and Cambridge sits
 * no January or October series), so the subject was entered with the board
 * that does. Each row stays here until staff mark it checked, or move it.
 * Shown only while there is something to check.
 */

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/tone';
import { SERIES_KEY } from '../exams-shared';

const fetchInferred = () => apiResponse(api.v1['board-series'].inferred.$get());

export function InferredCheck() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: [...SERIES_KEY, 'inferred'], queryFn: fetchInferred });
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState('');
  const check = useMutation({
    mutationFn: (registrationIds: string[]) => apiResponse(api.v1['board-series'].inferred.checked.$post({ json: { registrationIds } })),
    onSuccess: () => { setChosen([]); setError(''); queryClient.invalidateQueries({ queryKey: [...SERIES_KEY, 'inferred'] }); },
    onError: (err: Error) => setError(err.message),
  });
  const rows = q.data ?? [];
  if (!rows.length) return null;
  const all = rows.map((r) => r.registrationId);

  return (
    <Notice tone="warning" className="mb-6" title={`Check these: ${rows.length} registrations entered with another board by the migration`}>
      <p>
        Their subject&apos;s board does not sit the window&apos;s month, so the subject is now entered with the board that does. If a subject is really entered with another board, change it on the Catalogue; then mark what you checked.
      </p>
      <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card text-foreground">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="w-10 px-3 py-2">
                <input type="checkbox" aria-label="Choose all" checked={chosen.length === all.length} onChange={() => setChosen(chosen.length === all.length ? [] : all)} />
              </th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">Subject</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">Board</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">Window</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">Entered in</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">Student</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const on = chosen.includes(r.registrationId);
              return (
                <tr key={r.registrationId}>
                  <td className="px-3 py-1.5">
                    <input type="checkbox" aria-label={`Choose ${r.studentName} ${r.subjectName}`} checked={on} onChange={() => setChosen(on ? chosen.filter((x) => x !== r.registrationId) : [...chosen, r.registrationId])} />
                  </td>
                  <td className="px-3 py-1.5"><bdi data-i18n-skip="true">{r.subjectName}</bdi> <span className="font-mono text-xs text-muted-foreground" dir="ltr">{r.subjectCode}</span></td>
                  <td className="px-3 py-1.5">
                    <bdi data-i18n-skip="true" className="text-muted-foreground line-through">{r.previousBoardName}</bdi>{' '}
                    <span aria-hidden="true" className="inline-block rtl:rotate-180">→</span>{' '}
                    <bdi data-i18n-skip="true">{r.boardName}</bdi>
                  </td>
                  <td className="px-3 py-1.5"><bdi>{r.window}</bdi></td>
                  <td className="px-3 py-1.5"><bdi>{r.series}</bdi></td>
                  <td className="px-3 py-1.5"><bdi data-i18n-skip="true">{r.studentName}</bdi></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <p className="mt-2 text-red-700 dark:text-red-400">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!chosen.length || check.isPending} onClick={() => check.mutate(chosen)}>
          {check.isPending ? 'Saving…' : 'Mark the chosen as checked'}
        </Button>
        <Link href="/exams/catalogue?tab=registrable" className="text-sm font-medium underline hover:no-underline">
          Change a subject&apos;s board on the Catalogue
        </Link>
      </div>
    </Notice>
  );
}
