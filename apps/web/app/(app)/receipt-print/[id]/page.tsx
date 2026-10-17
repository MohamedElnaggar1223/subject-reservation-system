/**
 * Printable Receipt (UX_AUDIT G3)
 *
 * The physical paper the whole receipt system tracks — server-rendered,
 * clean print layout, auto-opens the print dialog.
 */

import { requireAuth } from '~/lib/auth/session';
import { getServerApi } from '~/lib/hono-server';
import { apiResponse, gradeLabel, formatEgp } from '@repo/validations';
import { readSchoolName } from '~/lib/school-name-server';
import { PrintHeading } from '~/components/print-heading';
import PrintButton from './print-button.client';

export const metadata = {
  title: 'Receipt — IGCSE',
};

// The receipt, typed from the route (CLAUDE.md: Hono RPC everywhere): a line's receipt, or (the
// reservations rework, §3.10 item 2) a charge's — a board service, an adjustment.
const fetchReceipt = (api: Awaited<ReturnType<typeof getServerApi>>, id: string) =>
  apiResponse(api.v1.receipts[':id'].$get({ param: { id } }));
type ReceiptDetail = Awaited<ReturnType<typeof fetchReceipt>>;

/** "EGP 14,000" (and "EGP 14,000.50" when there are piastres), as every money figure on the screens reads. */
const egp = formatEgp;

const COUNCILS: Record<string, string> = {
  pearson_edexcel: 'Pearson Edexcel',
  cambridge: 'Cambridge International',
  oxford: 'OxfordAQA',
};

export default async function ReceiptPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  // Any signed-in user may open this; the API scopes the receipt to
  // staff or the owning family and 403s everyone else.
  await requireAuth();
  const { id } = await params;
  const api = await getServerApi();
  // F8-11: the school's name heads the paper (the app's name alone while the setting is empty).
  const schoolName = await readSchoolName();

  let receipt: ReceiptDetail;
  try {
    receipt = await fetchReceipt(api, id);
  } catch {
    return (
      <div className="p-10 text-center text-muted-foreground">Receipt not found.</div>
    );
  }

  const reg = receipt.registration;
  const ch = receipt.charge;
  const student = reg?.student ?? ch?.student ?? null;
  const rows: [string, string][] = reg
    ? [
        ['Subject', `${reg.subject.name} (${reg.subject.code})`],
        // F6: the sheet's and the forms' words — "Board", "Board fee" — and amounts as the screens write them.
        ['Board', COUNCILS[reg.subject.council] ?? reg.subject.council],
        ['Session', reg.session.name],
        ['Course fee', egp(reg.courseFeeAtRegistration)],
        ['Board fee', egp(reg.registrationFeeAtRegistration)],
        ['Total paid', egp(reg.priceAtRegistration)],
      ]
    : ch
      ? [['Charge', ch.description], ['Total paid', egp(ch.amount)]]
      : [];

  return (
    <div className="mx-auto max-w-md p-8 print:p-0 print:max-w-none">
      <div className="border border-border rounded-xl p-8 print:border-0 print:rounded-none bg-card print:bg-white">
        <PrintHeading schoolName={schoolName} subtitle={reg ? 'Subject Registration Receipt' : 'Receipt'} className="text-center border-b border-border pb-4 mb-4" />

        <p className="text-center text-2xl font-bold tracking-widest font-mono text-foreground print:text-black mb-6">
          {receipt.receiptNumber}
        </p>

        <dl className="space-y-2 text-sm text-foreground print:text-black">
          {[
            ['Student', student ? `${student.name}${student.grade != null ? ` (${gradeLabel(student.grade)})` : ''}` : '—'],
            ['Student ID', student?.studentId ?? '—'],
            ...rows,
            ['Issued', new Date(receipt.createdAt).toLocaleDateString('en-GB')],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-muted-foreground print:text-black">{label}</dt>
              <dd className="font-medium text-right">{value}</dd>
            </div>
          ))}
        </dl>

        {reg?.takenOutsideSchool && (
          <p className="mt-3 text-xs text-muted-foreground print:text-black">
            Taken outside school (50% fee applies).
          </p>
        )}

        <div className="mt-8 pt-4 border-t border-border text-xs text-muted-foreground print:text-black">
          <p className="mb-6">
            Keep this receipt safe — it must be returned to the school if the subject is
            dropped or swapped.
          </p>
          <div className="flex justify-between gap-8">
            <span className="border-t border-current pt-1 flex-1 text-center">Finance signature</span>
            <span className="border-t border-current pt-1 flex-1 text-center">Parent signature</span>
          </div>
        </div>
      </div>

      <div className="mt-6 text-center print:hidden">
        <PrintButton />
      </div>
    </div>
  );
}
