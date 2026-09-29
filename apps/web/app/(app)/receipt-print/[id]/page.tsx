/**
 * Printable Receipt (UX_AUDIT G3)
 *
 * The physical paper the whole receipt system tracks — server-rendered,
 * clean print layout, auto-opens the print dialog.
 */

import { requireAuth } from '~/lib/auth/session';
import { getServerApi } from '~/lib/hono-server';
import { apiResponse, gradeLabel } from '@repo/validations';
import PrintButton from './print-button.client';

export const metadata = {
  title: 'Receipt — IGCSE',
};

type ReceiptDetail = {
  id: string;
  receiptNumber: string;
  status: string;
  createdAt: string;
  registration: {
    priceAtRegistration: number;
    courseFeeAtRegistration: number;
    registrationFeeAtRegistration: number;
    takenOutsideSchool: boolean;
    student: { name: string; studentId: string | null; grade: number | null };
    subject: { name: string; code: string; council: string };
    session: { name: string };
  };
};

const COUNCILS: Record<string, string> = {
  pearson_edexcel: 'Pearson Edexcel',
  cambridge: 'Cambridge',
  oxford: 'Oxford',
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

  let receipt: ReceiptDetail;
  try {
    receipt = (await apiResponse(
      api.v1.receipts[':id'].$get({ param: { id } })
    )) as ReceiptDetail;
  } catch {
    return (
      <div className="p-10 text-center text-muted-foreground">Receipt not found.</div>
    );
  }

  const reg = receipt.registration;

  return (
    <div className="mx-auto max-w-md p-8 print:p-0 print:max-w-none">
      <div className="border border-border rounded-xl p-8 print:border-0 print:rounded-none bg-card print:bg-white">
        <div className="text-center border-b border-border pb-4 mb-4">
          <h1 className="text-xl font-bold text-foreground print:text-black font-display">
            IGCSE Subject Reservation System
          </h1>
          <p className="text-sm text-muted-foreground print:text-black mt-1">Subject Registration Receipt</p>
        </div>

        <p className="text-center text-2xl font-bold tracking-widest font-mono text-foreground print:text-black mb-6">
          {receipt.receiptNumber}
        </p>

        <dl className="space-y-2 text-sm text-foreground print:text-black">
          {[
            ['Student', `${reg.student.name}${reg.student.grade != null ? ` (${gradeLabel(reg.student.grade)})` : ''}`],
            ['Student ID', reg.student.studentId ?? '—'],
            ['Subject', `${reg.subject.name} (${reg.subject.code})`],
            ['Council', COUNCILS[reg.subject.council] ?? reg.subject.council],
            ['Session', reg.session.name],
            ['Course fee', `EGP ${reg.courseFeeAtRegistration.toFixed(2)}`],
            ['Registration fee', `EGP ${reg.registrationFeeAtRegistration.toFixed(2)}`],
            ['Total paid', `EGP ${reg.priceAtRegistration.toFixed(2)}`],
            ['Issued', new Date(receipt.createdAt).toLocaleDateString('en-GB')],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-muted-foreground print:text-black">{label}</dt>
              <dd className="font-medium text-right">{value}</dd>
            </div>
          ))}
        </dl>

        {reg.takenOutsideSchool && (
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
