'use client';

/**
 * Check these: what the F0b migration inferred. The school's January and
 * October rows were all "Cambridge", and Cambridge sits no January or October
 * series, so:
 * - a subject registered or offered in such a window was entered with the
 *   board that sits it (its registrations listed below it);
 * - a subject kept on its board (its registrations elsewhere are the
 *   evidence) is not offered in a window of a month its board does not sit.
 * Each row stays until staff mark it checked (or map the subject on the
 * Catalogue, or move the registration). Shown only while there is something
 * to check.
 */

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { SERIES_KEY } from '../exams-shared';

const fetchInferred = () => apiResponse(api.v1['board-series'].inferred.$get());

export function InferredCheck() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: [...SERIES_KEY, 'inferred'], queryFn: fetchInferred });
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [registrationIds, setRegistrationIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const check = useMutation({
    mutationFn: () => apiResponse(api.v1['board-series'].inferred.checked.$post({ json: { subjectIds, registrationIds } })),
    onSuccess: () => {
      setSubjectIds([]);
      setRegistrationIds([]);
      setError('');
      queryClient.invalidateQueries({ queryKey: [...SERIES_KEY, 'inferred'] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const subjects = q.data?.subjects ?? [];
  const regs = q.data?.registrations ?? [];
  if (!subjects.length && !regs.length) return null;
  const toggle = (list: string[], set: (x: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <Notice tone="warning" className="mb-6" title={`Check these: ${subjects.length + regs.length} things the migration inferred`}>
      <p>
        The school&apos;s January and October rows were entered with Cambridge International, which sits no January or October series. Each subject below is now entered with the board that sits it, or is not offered in those windows. If a subject is really entered with another board, change it on the Catalogue; then mark what you checked.
      </p>

      {subjects.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card text-foreground">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="w-10 px-3 py-2"><span className="sr-only">Choose</span></th>
                <th scope="col" className="px-3 py-2 text-start font-semibold">Subject</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold">Board</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold">What the migration did</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold">Windows</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {subjects.map((x) => (
                <tr key={`${x.subjectId}-${x.kind}`}>
                  <td className="px-3 py-1.5">
                    <input type="checkbox" aria-label={`Choose ${x.subjectName}`} checked={subjectIds.includes(x.subjectId)} onChange={() => toggle(subjectIds, setSubjectIds, x.subjectId)} />
                  </td>
                  <td className="px-3 py-1.5"><bdi data-i18n-skip="true">{x.subjectName}</bdi> <span className="font-mono text-xs text-muted-foreground" dir="ltr">{x.subjectCode}</span></td>
                  <td className="px-3 py-1.5">
                    {x.kind === 'reboarded' && x.previousBoardName && (
                      <><bdi data-i18n-skip="true" className="text-muted-foreground line-through">{x.previousBoardName}</bdi>{' '}<span aria-hidden="true" className="inline-block rtl:rotate-180">→</span>{' '}</>
                    )}
                    <bdi data-i18n-skip="true">{x.boardName}</bdi>
                  </td>
                  <td className="px-3 py-1.5">
                    {x.kind === 'reboarded'
                      ? <Badge tone="warning">{x.registered ? 'Entered with another board' : 'Entered with another board (offered only)'}</Badge>
                      : <Badge tone="neutral">Not offered in these windows</Badge>}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{x.windows.map((n, i) => <span key={n}>{i > 0 && ', '}<bdi>{n}</bdi></span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {regs.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card text-foreground">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="w-10 px-3 py-2"><span className="sr-only">Choose</span></th>
                <th scope="col" className="px-3 py-2 text-start font-semibold">Subject</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold">Window</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold">Entered in</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold">Student</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {regs.map((r) => (
                <tr key={r.registrationId}>
                  <td className="px-3 py-1.5">
                    <input type="checkbox" aria-label={`Choose ${r.studentName} ${r.subjectName}`} checked={registrationIds.includes(r.registrationId)} onChange={() => toggle(registrationIds, setRegistrationIds, r.registrationId)} />
                  </td>
                  <td className="px-3 py-1.5"><bdi data-i18n-skip="true">{r.subjectName}</bdi> <span className="font-mono text-xs text-muted-foreground" dir="ltr">{r.subjectCode}</span></td>
                  <td className="px-3 py-1.5"><bdi>{r.window}</bdi></td>
                  <td className="px-3 py-1.5"><bdi>{r.series}</bdi></td>
                  <td className="px-3 py-1.5"><bdi data-i18n-skip="true">{r.studentName}</bdi></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="mt-2 text-red-700 dark:text-red-400">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!(subjectIds.length + registrationIds.length) || check.isPending} onClick={() => check.mutate()}>
          {check.isPending ? 'Saving…' : 'Mark the chosen as checked'}
        </Button>
        <Link href="/exams/catalogue?tab=registrable" className="text-sm font-medium underline hover:no-underline">
          Change a subject&apos;s board on the Catalogue
        </Link>
      </div>
    </Notice>
  );
}
