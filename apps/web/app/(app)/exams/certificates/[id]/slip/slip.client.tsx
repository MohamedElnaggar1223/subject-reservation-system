'use client';

/**
 * A certificate's collection slip (docs/features/EXAM_ENTRIES.md §5).
 *
 * The paper version: the officer writes the candidate's name, the series
 * and the collector into a register by hand and the collector signs the
 * line — the centre number, the name as the board printed it and what the
 * certificate lists are copied again, or left out.
 *
 * Here the slip prints itself from the record: the centre number, the
 * candidate as on their ID (as the board prints it), the series, what the
 * certificate lists, the collector, the ID checked, the date and the member
 * of staff who handed it over, with signature lines. Printed before the
 * hand-over is recorded, the collector's lines are left blank to fill in
 * by hand. The navigation and the buttons do not print.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { Notice } from '~/components/ui/tone';
import { InstantText, MaybeDate } from '../../../exams-shared';
import { EXAMS_KEY, BoardText, Code, PrintButton } from '../../../exam-f4-shared';

const fetchSlip = (id: string) => apiResponse(api.v1.exams.certificates[':id'].slip.$get({ param: { id } }));

export default function SlipClient({ id, autoPrint }: { id: string; autoPrint: boolean }): React.JSX.Element {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: [...EXAMS_KEY, 'certificate-slip', id], queryFn: () => fetchSlip(id) });

  // Reached from "Print the collection slip": open the print dialog, as the receipt does.
  useEffect(() => {
    if (!autoPrint || !data) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [autoPrint, data]);

  if (isLoading) return <LoadingState label="Loading the slip…" />;
  if (isError || !data) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <ErrorState title="The slip did not load" message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
      </div>
    );
  }

  const c = data.certificate;
  const collected = c.status === 'collected';
  const gone = c.status === 'returned_to_board' || c.status === 'destroyed';

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 print:max-w-none print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/exams/certificates" className="text-sm text-primary underline-offset-4 hover:underline">Back to certificates</Link>
        <PrintButton label="Print the slip" />
      </div>

      {gone && (
        <Notice tone="warning" className="mb-4 print:hidden">
          This certificate is no longer here: it was returned to the board or destroyed. There is nothing to hand over.
        </Notice>
      )}
      {!collected && !gone && (
        <p className="mb-4 text-sm text-muted-foreground print:hidden">
          Not handed over yet: the collector&apos;s lines are blank, to fill in by hand. Record the hand-over on the Certificates screen.
        </p>
      )}

      <article className="rounded-xl border border-border bg-card p-8 text-foreground shadow-sm print:rounded-none print:border-0 print:bg-white print:p-0 print:text-black print:shadow-none">
        <div className="border-b border-border pb-4 text-center">
          <h1 className="font-display text-xl font-bold">Certificate collection slip</h1>
          <p className="mt-1 text-sm">
            <span>Centre number</span>{' '}
            {data.centre.centreNumber ? <Code className="font-semibold">{data.centre.centreNumber}</Code> : <span>not set (Settings)</span>}
          </p>
        </div>

        <dl className="mt-5 grid grid-cols-[minmax(0,11rem)_1fr] gap-x-4 gap-y-2.5 text-sm">
          <dt className="text-muted-foreground print:text-black">Candidate, as on their ID</dt>
          <dd className="font-semibold">
            {data.candidate.legalName ? <bdi data-i18n-skip="true">{data.candidate.legalName}</bdi> : (
              <>
                <bdi data-i18n-skip="true">{data.candidate.name}</bdi>{' '}
                <span className="font-normal text-muted-foreground">(no legal name recorded: check the ID)</span>
              </>
            )}
          </dd>
          <dt className="text-muted-foreground print:text-black">School record</dt>
          <dd>
            <bdi data-i18n-skip="true">{data.candidate.name}</bdi>
            {data.candidate.studentCode && <> · <Code>{data.candidate.studentCode}</Code></>}
          </dd>
          <dt className="text-muted-foreground print:text-black">Series</dt>
          <dd><BoardText>{data.seriesName}</BoardText></dd>
          <dt className="text-muted-foreground print:text-black">The certificate lists</dt>
          <dd><BoardText>{c.description}</BoardText></dd>
          <dt className="text-muted-foreground print:text-black">Received by the school</dt>
          <dd><MaybeDate date={c.receivedOn} /></dd>
        </dl>

        <h2 className="mt-6 border-t border-border pt-4 text-sm font-semibold">Collected by</h2>
        <dl className="mt-3 grid grid-cols-[minmax(0,11rem)_1fr] gap-x-4 gap-y-3 text-sm">
          <dt className="text-muted-foreground print:text-black">Name, as on their ID</dt>
          <dd>{collected && c.collectorName ? <bdi data-i18n-skip="true" className="font-semibold">{c.collectorName}</bdi> : <BlankLine />}</dd>
          <dt className="text-muted-foreground print:text-black">Who they are</dt>
          <dd>{collected && data.collectorRelationLabel ? <span>{data.collectorRelationLabel}</span> : <BlankLine />}</dd>
          <dt className="text-muted-foreground print:text-black">ID checked</dt>
          <dd>{collected && data.collectorIdLabel ? <span>{data.collectorIdLabel}</span> : <BlankLine />}</dd>
          <dt className="text-muted-foreground print:text-black">Date</dt>
          <dd>{collected && c.collectedAt ? <InstantText iso={c.collectedAt} /> : <BlankLine />}</dd>
          <dt className="text-muted-foreground print:text-black">Handed over by</dt>
          <dd>{collected && data.handedOverBy ? <bdi data-i18n-skip="true">{data.handedOverBy}</bdi> : <BlankLine />}</dd>
        </dl>

        <p className="mt-6 text-sm">I have received the certificate described above.</p>
        <div className="mt-8 grid grid-cols-2 gap-8 text-xs">
          <Signature label="Collector's signature" />
          <Signature label="Date" />
          <Signature label="Staff signature" />
          <Signature label="School stamp" />
        </div>
        <p className="mt-8 text-xs text-muted-foreground print:text-black">Keep this slip with the school&apos;s certificate records.</p>
      </article>
    </div>
  );
}

function BlankLine() {
  return <span className="block h-5 border-b border-dashed border-border print:border-black" aria-label="to fill in" />;
}

function Signature({ label }: { label: string }) {
  return (
    <div>
      <div className="h-10 border-b border-foreground print:border-black" />
      <p className="mt-1 text-muted-foreground print:text-black">{label}</p>
    </div>
  );
}
