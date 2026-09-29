/**
 * Email Integration — Resend
 *
 * Sends transactional emails using Resend (https://resend.com).
 * When RESEND_API_KEY is not set, all send calls log to the console
 * and return a stub result — identical to the payment gateway pattern.
 *
 * Required env vars:
 * - RESEND_API_KEY       — Resend API key (get from https://resend.com/api-keys)
 * - EMAIL_FROM          — Verified sender address, e.g. "IGCSE System <noreply@school.com>"
 * - APP_URL             — Public app URL for deep-link buttons (e.g. https://app.school.com)
 *
 * Template system:
 * Each exported helper (sendSessionOpenedEmail, sendRegistrationRequestEmail, etc.)
 * generates a typed HTML email body for one notification type and calls sendEmail().
 *
 * TODO (Production):
 * - Add DKIM/SPF records for the sending domain via Resend dashboard
 * - Swap stub functions with live Resend calls (already wired — just add the API key)
 * - Consider Resend's React Email templates for richer HTML
 */

import { Resend } from 'resend';
import { gradeLabel } from '@repo/validations';

// ─── Init ─────────────────────────────────────────────────────────────────────

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const EMAIL_FROM = process.env.EMAIL_FROM ?? 'IGCSE System <noreply@school.com>';
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const STUB_MODE = !resend;

if (STUB_MODE) {
  console.warn('[email] RESEND_API_KEY not set — running in stub mode (no emails sent)');
}

// ─── HTML Safety ──────────────────────────────────────────────────────────────

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Core Send ────────────────────────────────────────────────────────────────

export type EmailAttachment = {
  filename: string;
  content: Buffer | string;
  contentType?: string;
};

export type EmailPayload = {
  to: string | string[];
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
};

export type EmailResult = {
  success: boolean;
  messageId?: string;
  stubbed?: boolean;
  error?: string;
};

export async function sendEmail(payload: EmailPayload): Promise<EmailResult> {
  if (STUB_MODE) {
    console.log(
      '[email:stub] To:', payload.to,
      '| Subject:', payload.subject,
      payload.attachments ? `| Attachments: ${payload.attachments.map((a) => a.filename).join(', ')}` : '',
    );
    return { success: true, stubbed: true, messageId: `stub-${Date.now()}` };
  }

  try {
    const result = await resend!.emails.send({
      from: EMAIL_FROM,
      to: Array.isArray(payload.to) ? payload.to : [payload.to],
      subject: payload.subject,
      html: payload.html,
      // Resend accepts attachments as { filename, content } — content is
      // a Buffer or a base64-encoded string. We pass Buffer through directly
      // since that matches what pdfkit-style generators produce.
      ...(payload.attachments && payload.attachments.length > 0
        ? {
            attachments: payload.attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              ...(a.contentType ? { contentType: a.contentType } : {}),
            })),
          }
        : {}),
    });

    if (result.error) {
      console.error('[email] Resend error:', result.error);
      return { success: false, error: result.error.message };
    }

    return { success: true, messageId: result.data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[email] Unexpected error:', msg);
    return { success: false, error: msg };
  }
}

// ─── HTML Layout Helpers ──────────────────────────────────────────────────────

function emailLayout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <style>
    body { margin: 0; padding: 0; background: #f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
    .header { background: #1e40af; padding: 24px 32px; }
    .header h1 { margin: 0; color: #ffffff; font-size: 20px; font-weight: 600; }
    .header p { margin: 4px 0 0; color: #bfdbfe; font-size: 13px; }
    .content { padding: 32px; color: #1f2937; font-size: 15px; line-height: 1.6; }
    .content h2 { margin-top: 0; font-size: 18px; color: #111827; }
    .info-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px 20px; margin: 20px 0; }
    .info-box table { width: 100%; border-collapse: collapse; }
    .info-box td { padding: 6px 0; font-size: 14px; }
    .info-box td:first-child { color: #6b7280; font-weight: 500; width: 45%; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .badge-blue { background: #dbeafe; color: #1d4ed8; }
    .badge-green { background: #d1fae5; color: #065f46; }
    .badge-red { background: #fee2e2; color: #991b1b; }
    .badge-yellow { background: #fef3c7; color: #92400e; }
    .btn { display: inline-block; padding: 12px 24px; background: #1e40af; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px; margin-top: 8px; }
    .footer { padding: 20px 32px; background: #f9fafb; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; text-align: center; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>IGCSE Subject Reservation System</h1>
      <p>Automated notification — please do not reply to this email</p>
    </div>
    <div class="content">${body}</div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} IGCSE Subject Reservation System &middot;
      <a href="${APP_URL}/notifications" style="color:#6b7280">View in app</a>
    </div>
  </div>
</body>
</html>`;
}

function actionButton(label: string, url: string): string {
  // Only allow http/https URLs to prevent javascript: or data: XSS
  const safeUrl = /^https?:\/\//i.test(url) ? esc(url) : '#';
  return `<p><a href="${safeUrl}" class="btn">${label}</a></p>`;
}

// ─── Notification-Specific Email Templates ────────────────────────────────────

/** NOT-001: Session opened — sent to all students and parents */
export async function sendSessionOpenedEmail(to: string, data: {
  recipientName: string;
  sessionName: string;
  sessionType: string;
  deadline: string;
}): Promise<EmailResult> {
  const html = emailLayout('Registration Window Now Open', `
    <h2>A registration window is now open</h2>
    <p>Hello ${esc(data.recipientName)},</p>
    <p>A new subject registration window has opened. Register before the deadline to secure your subjects.</p>
    <div class="info-box">
      <table>
        <tr><td>Session</td><td><strong>${esc(data.sessionName)}</strong></td></tr>
        <tr><td>Type</td><td>${esc(data.sessionType)}</td></tr>
        <tr><td>Registration deadline</td><td><strong>${esc(data.deadline)}</strong></td></tr>
      </table>
    </div>
    ${actionButton('Register Now', `${APP_URL}/register`)}
  `);

  return sendEmail({ to, subject: `Registration Open — ${data.sessionName}`, html });
}

/** NOT-002: Session closing soon — 24-hour reminder */
export async function sendSessionClosingSoonEmail(to: string, data: {
  recipientName: string;
  sessionName: string;
  deadline: string;
}): Promise<EmailResult> {
  const html = emailLayout('Registration Closing in 24 Hours', `
    <h2>Reminder: Registration closes soon</h2>
    <p>Hello ${esc(data.recipientName)},</p>
    <p>The registration window for <strong>${esc(data.sessionName)}</strong> closes in approximately 24 hours.</p>
    <div class="info-box">
      <table>
        <tr><td>Session</td><td><strong>${esc(data.sessionName)}</strong></td></tr>
        <tr><td>Deadline</td><td><strong>${esc(data.deadline)}</strong></td></tr>
      </table>
    </div>
    ${actionButton('Register Now', `${APP_URL}/register`)}
  `);

  return sendEmail({ to, subject: `Reminder: Registration closes soon — ${data.sessionName}`, html });
}

/** Session closed — sent to all students and parents */
export async function sendSessionClosedEmail(to: string, data: {
  recipientName: string;
  sessionName: string;
  reason?: string;
}): Promise<EmailResult> {
  const html = emailLayout('Registration Window Closed', `
    <h2>Registration window closed</h2>
    <p>Hello ${esc(data.recipientName)},</p>
    <p>The registration window for <strong>${esc(data.sessionName)}</strong> has been closed.</p>
    ${data.reason ? `<div class="info-box"><table><tr><td>Reason</td><td>${esc(data.reason)}</td></tr></table></div>` : ''}
    <p>No further registrations or changes can be made for this session.</p>
    ${actionButton('View Registrations', `${APP_URL}/registrations`)}
  `);

  return sendEmail({ to, subject: `Registration Closed — ${data.sessionName}`, html });
}

/** NOT-003: Parent notified when child submits registration request */
export async function sendRegistrationRequestReceivedEmail(to: string, data: {
  parentName: string;
  studentName: string;
  sessionName: string;
  subjects: { name: string; price: number }[];
  totalCost: number;
}): Promise<EmailResult> {
  const subjectRows = data.subjects
    .map((s) => `<tr><td>${esc(s.name)}</td><td>EGP ${s.price.toFixed(2)}</td></tr>`)
    .join('');

  const html = emailLayout('Registration Request Requires Your Approval', `
    <h2>Your child has submitted a registration request</h2>
    <p>Hello ${esc(data.parentName)},</p>
    <p><strong>${esc(data.studentName)}</strong> has submitted a registration request for the following subjects. Your approval is required before payment can proceed.</p>
    <div class="info-box">
      <table>
        <tr><td>Session</td><td><strong>${esc(data.sessionName)}</strong></td></tr>
        <tr><td>Student</td><td>${esc(data.studentName)}</td></tr>
      </table>
    </div>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e5e7eb;">Subject</th>
          <th style="text-align:right;padding:8px 12px;border-bottom:1px solid #e5e7eb;">Price</th>
        </tr>
      </thead>
      <tbody>${subjectRows}</tbody>
      <tfoot>
        <tr>
          <td style="padding:10px 12px;font-weight:600;border-top:2px solid #e5e7eb;">Total</td>
          <td style="padding:10px 12px;font-weight:600;text-align:right;border-top:2px solid #e5e7eb;">EGP ${data.totalCost.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
    ${actionButton('Review & Approve', `${APP_URL}/approvals`)}
    <p style="font-size:13px;color:#6b7280;">You can also reject the request from the approvals page if needed.</p>
  `);

  return sendEmail({ to, subject: `Action Required: ${data.studentName}'s registration request`, html });
}

/**
 * REG-003: Student notified when a parent directly registers subjects for
 * them. No approval is needed (parents can auto-approve for linked
 * children) — this email is informational.
 */
export async function sendDirectRegistrationEmail(to: string, data: {
  studentName: string;
  parentName: string;
  sessionName: string;
  subjects: { name: string; price: number }[];
  totalCost: number;
}): Promise<EmailResult> {
  const subjectRows = data.subjects
    .map((s) => `<tr><td>${esc(s.name)}</td><td>EGP ${s.price.toFixed(2)}</td></tr>`)
    .join('');

  const html = emailLayout('Your parent registered subjects for you', `
    <h2>${esc(data.parentName)} registered subjects for you</h2>
    <p>Hello ${esc(data.studentName)},</p>
    <p>Your parent has registered the following subjects for you in <strong>${esc(data.sessionName)}</strong>. Payment is pending; you'll receive a confirmation once payment is complete.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e5e7eb;">Subject</th>
          <th style="text-align:right;padding:8px 12px;border-bottom:1px solid #e5e7eb;">Price</th>
        </tr>
      </thead>
      <tbody>${subjectRows}</tbody>
      <tfoot>
        <tr>
          <td style="padding:10px 12px;font-weight:600;border-top:2px solid #e5e7eb;">Total</td>
          <td style="padding:10px 12px;font-weight:600;text-align:right;border-top:2px solid #e5e7eb;">EGP ${data.totalCost.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
    ${actionButton('View My Registrations', `${APP_URL}/registrations`)}
  `);

  return sendEmail({
    to,
    subject: `Your parent registered you for ${data.subjects.length} subject${data.subjects.length === 1 ? '' : 's'}`,
    html,
  });
}

/** NOT-004: Student notified when registration request is approved or rejected */
export async function sendRegistrationDecisionEmail(to: string, data: {
  studentName: string;
  sessionName: string;
  approved: boolean;
  parentName: string;
  comments?: string;
}): Promise<EmailResult> {
  const badgeClass = data.approved ? 'badge-green' : 'badge-red';
  const badgeLabel = data.approved ? 'Approved' : 'Rejected';
  const intro = data.approved
    ? 'Your registration request has been <strong>approved</strong>. Payment can now be completed by your parent.'
    : 'Your registration request has been <strong>rejected</strong>.';

  const html = emailLayout(`Registration ${badgeLabel}`, `
    <h2>Registration request ${badgeLabel.toLowerCase()}</h2>
    <p>Hello ${esc(data.studentName)},</p>
    <p>${intro}</p>
    <div class="info-box">
      <table>
        <tr><td>Session</td><td><strong>${esc(data.sessionName)}</strong></td></tr>
        <tr><td>Decision by</td><td>${esc(data.parentName)}</td></tr>
        <tr><td>Status</td><td><span class="badge ${badgeClass}">${badgeLabel}</span></td></tr>
        ${data.comments ? `<tr><td>Comments</td><td>${esc(data.comments)}</td></tr>` : ''}
      </table>
    </div>
    ${actionButton('View Registrations', `${APP_URL}/registrations`)}
  `);

  return sendEmail({
    to,
    subject: `Your registration request was ${badgeLabel.toLowerCase()} — ${data.sessionName}`,
    html,
  });
}

/** NOT-005: Parent receives payment receipt after registration is confirmed */
export async function sendPaymentReceiptEmail(to: string, data: {
  parentName: string;
  studentName: string;
  sessionName: string;
  amount: number;
  method: string;
  paymentId: string;
  subjects: string[];
  /**
   * Optional PDF receipt buffer. When provided, it's attached to the email
   * so parents have an offline copy without needing to hit the /receipt
   * endpoint (URD PAY-006: "Downloadable PDF receipt available in
   * dashboard" + NOT-005 receipt-via-email).
   */
  receiptPdf?: Buffer;
}): Promise<EmailResult> {
  const subjectList = data.subjects.map((s) => `<li>${esc(s)}</li>`).join('');

  const html = emailLayout('Payment Confirmed', `
    <h2>Payment confirmed</h2>
    <p>Hello ${esc(data.parentName)},</p>
    <p>Payment for <strong>${esc(data.studentName)}</strong>'s registration has been confirmed. The subjects are now fully registered.</p>
    <div class="info-box">
      <table>
        <tr><td>Student</td><td>${esc(data.studentName)}</td></tr>
        <tr><td>Session</td><td><strong>${esc(data.sessionName)}</strong></td></tr>
        <tr><td>Amount paid</td><td><strong>EGP ${data.amount.toFixed(2)}</strong></td></tr>
        <tr><td>Payment method</td><td>${esc(data.method)}</td></tr>
        <tr><td>Reference #</td><td><code>${data.paymentId}</code></td></tr>
      </table>
    </div>
    <p><strong>Registered subjects:</strong></p>
    <ul style="font-size:14px;line-height:1.8;">${subjectList}</ul>
    ${data.receiptPdf ? '<p style="font-size:13px;color:#6b7280;">A PDF receipt is attached to this email.</p>' : ''}
    ${actionButton('View Registrations', `${APP_URL}/registrations`)}
  `);

  return sendEmail({
    to,
    subject: `Payment confirmed — ${data.sessionName}`,
    html,
    ...(data.receiptPdf
      ? {
          attachments: [{
            filename: `receipt-${data.paymentId}.pdf`,
            content: data.receiptPdf,
            contentType: 'application/pdf',
          }],
        }
      : {}),
  });
}

/** NOT-006: Parent notified when child requests a drop or swap */
export async function sendDropSwapRequestEmail(to: string, data: {
  parentName: string;
  studentName: string;
  changeType: 'drop' | 'swap';
  subjectName: string;
  newSubjectName?: string;
  financialImpact: string;
  reason?: string;
}): Promise<EmailResult> {
  const verb = data.changeType === 'drop' ? 'drop' : 'swap';
  const changeDesc = data.changeType === 'swap' && data.newSubjectName
    ? `swap <strong>${esc(data.subjectName)}</strong> for <strong>${esc(data.newSubjectName)}</strong>`
    : `drop <strong>${esc(data.subjectName)}</strong>`;

  const html = emailLayout('Subject Change Request Requires Approval', `
    <h2>Your child has requested a subject ${verb}</h2>
    <p>Hello ${esc(data.parentName)},</p>
    <p><strong>${esc(data.studentName)}</strong> has requested to ${changeDesc}. Your approval is required.</p>
    <div class="info-box">
      <table>
        <tr><td>Type</td><td><span class="badge badge-blue">${esc(data.changeType.toUpperCase())}</span></td></tr>
        <tr><td>Subject</td><td>${esc(data.subjectName)}</td></tr>
        ${data.newSubjectName ? `<tr><td>New subject</td><td>${esc(data.newSubjectName)}</td></tr>` : ''}
        <tr><td>Financial impact</td><td>${esc(data.financialImpact)}</td></tr>
        ${data.reason ? `<tr><td>Reason given</td><td>${esc(data.reason)}</td></tr>` : ''}
      </table>
    </div>
    ${actionButton('Review & Approve', `${APP_URL}/approvals`)}
  `);

  return sendEmail({
    to,
    subject: `Action Required: ${data.studentName} requested a subject ${verb}`,
    html,
  });
}

/** NOT-007: Student notified when their drop/swap request is processed */
export async function sendDropSwapProcessedEmail(to: string, data: {
  studentName: string;
  changeType: 'drop' | 'swap';
  subjectName: string;
  newSubjectName?: string;
  approved: boolean;
  parentName: string;
  financialImpact: string;
  comments?: string;
}): Promise<EmailResult> {
  const badgeClass = data.approved ? 'badge-green' : 'badge-red';
  const badgeLabel = data.approved ? 'Approved' : 'Rejected';
  const verb = data.changeType === 'drop' ? 'drop' : 'swap';

  const html = emailLayout(`Subject ${data.changeType.toUpperCase()} Request ${badgeLabel}`, `
    <h2>Your ${verb} request was ${badgeLabel.toLowerCase()}</h2>
    <p>Hello ${esc(data.studentName)},</p>
    <div class="info-box">
      <table>
        <tr><td>Request type</td><td>${esc(data.changeType.toUpperCase())}</td></tr>
        <tr><td>Subject</td><td>${esc(data.subjectName)}</td></tr>
        ${data.newSubjectName ? `<tr><td>New subject</td><td>${esc(data.newSubjectName)}</td></tr>` : ''}
        <tr><td>Decision</td><td><span class="badge ${badgeClass}">${badgeLabel}</span></td></tr>
        <tr><td>Decided by</td><td>${esc(data.parentName)}</td></tr>
        <tr><td>Financial impact</td><td>${esc(data.financialImpact)}</td></tr>
        ${data.comments ? `<tr><td>Comments</td><td>${esc(data.comments)}</td></tr>` : ''}
      </table>
    </div>
    ${actionButton('View Registrations', `${APP_URL}/registrations`)}
  `);

  return sendEmail({
    to,
    subject: `Your ${verb} request was ${badgeLabel.toLowerCase()}`,
    html,
  });
}

/**
 * NOT-007 (SWAP-004 direct-action variant): Student notified when a parent
 * directly drops or swaps a subject on their behalf. Unlike the
 * change-request variant above, there's no approval decision to report —
 * the parent took the action directly, so wording is informational.
 */
export async function sendDirectDropSwapEmail(to: string, data: {
  studentName: string;
  changeType: 'drop' | 'swap';
  subjectName: string;
  newSubjectName?: string;
  parentName: string;
  financialImpact: string;
}): Promise<EmailResult> {
  const verb = data.changeType === 'drop' ? 'dropped' : 'swapped';
  const titleCase = data.changeType === 'drop' ? 'Drop' : 'Swap';

  const html = emailLayout(`Subject ${titleCase} — Processed by Your Parent`, `
    <h2>${esc(data.parentName)} ${verb} a subject for you</h2>
    <p>Hello ${esc(data.studentName)},</p>
    <p>Your parent has processed a ${data.changeType} on your behalf. No approval from you is required because parents act as the approving party.</p>
    <div class="info-box">
      <table>
        <tr><td>Action</td><td>${esc(titleCase)}</td></tr>
        <tr><td>Subject</td><td>${esc(data.subjectName)}</td></tr>
        ${data.newSubjectName ? `<tr><td>New subject</td><td>${esc(data.newSubjectName)}</td></tr>` : ''}
        <tr><td>Processed by</td><td>${esc(data.parentName)}</td></tr>
        <tr><td>Financial impact</td><td>${esc(data.financialImpact)}</td></tr>
      </table>
    </div>
    ${actionButton('View Registrations', `${APP_URL}/registrations`)}
  `);

  return sendEmail({
    to,
    subject: `Your parent ${verb} a subject for you`,
    html,
  });
}

/** NOT-008: Parent notified when a child's escrow balance changes */
export async function sendEscrowBalanceChangedEmail(to: string, data: {
  parentName: string;
  studentName: string;
  previousBalance: number;
  newBalance: number;
  changeAmount: number;
  reason: string;
}): Promise<EmailResult> {
  const direction = data.changeAmount >= 0 ? 'Credited' : 'Debited';
  const badgeClass = data.changeAmount >= 0 ? 'badge-green' : 'badge-yellow';
  const absAmount = Math.abs(data.changeAmount);

  const html = emailLayout("Child's Escrow Balance Updated", `
    <h2>Escrow balance updated for ${esc(data.studentName)}</h2>
    <p>Hello ${esc(data.parentName)},</p>
    <p>Your child's escrow account balance has been updated.</p>
    <div class="info-box">
      <table>
        <tr><td>Student</td><td>${esc(data.studentName)}</td></tr>
        <tr><td>Previous balance</td><td>EGP ${data.previousBalance.toFixed(2)}</td></tr>
        <tr><td>Change</td><td><span class="badge ${badgeClass}">${direction}: EGP ${absAmount.toFixed(2)}</span></td></tr>
        <tr><td>New balance</td><td><strong>EGP ${data.newBalance.toFixed(2)}</strong></td></tr>
        <tr><td>Reason</td><td>${esc(data.reason)}</td></tr>
      </table>
    </div>
    ${actionButton('View Escrow', `${APP_URL}/escrow`)}
  `);

  return sendEmail({ to, subject: `Escrow balance updated for ${data.studentName}`, html });
}

/** NOT-009: Parent notified when a withdrawal request is fulfilled */
export async function sendWithdrawalFulfilledEmail(to: string, data: {
  parentName: string;
  studentName: string;
  amountRequested: number;
  amountReleased: number;
  remainingBalance: number;
  adminNotes?: string;
}): Promise<EmailResult> {
  const partial = data.amountReleased < data.amountRequested;

  const html = emailLayout('Escrow Withdrawal Fulfilled', `
    <h2>Withdrawal ${partial ? 'partially ' : ''}fulfilled</h2>
    <p>Hello ${esc(data.parentName)},</p>
    <p>An escrow withdrawal for <strong>${esc(data.studentName)}</strong> has been ${partial ? 'partially ' : ''}processed. Please collect from the school office.</p>
    <div class="info-box">
      <table>
        <tr><td>Student</td><td>${esc(data.studentName)}</td></tr>
        <tr><td>Amount requested</td><td>EGP ${data.amountRequested.toFixed(2)}</td></tr>
        <tr><td>Amount released</td><td><strong>EGP ${data.amountReleased.toFixed(2)}</strong></td></tr>
        <tr><td>Remaining balance</td><td>EGP ${data.remainingBalance.toFixed(2)}</td></tr>
        ${data.adminNotes ? `<tr><td>Admin notes</td><td>${esc(data.adminNotes)}</td></tr>` : ''}
      </table>
    </div>
    ${actionButton('View Escrow', `${APP_URL}/escrow`)}
  `);

  return sendEmail({ to, subject: `Escrow withdrawal processed for ${data.studentName}`, html });
}

/** GRADE-001/002: Student and parents notified when a grade change occurs */
export async function sendGradeChangedEmail(to: string, data: {
  recipientName: string;
  studentName: string;
  previousGrade: number | null;
  newGrade: number | null;
  reason: string;
  isStudent: boolean;
}): Promise<EmailResult> {
  // F0a: the shared label (above 12 graduated, null not recorded).

  const html = emailLayout(
    `Grade Updated: ${gradeLabel(data.newGrade)}`,
    `
    <h2>${data.isStudent ? 'Your grade has been updated' : `${esc(data.studentName)}'s grade has been updated`}</h2>
    <p>Hello ${esc(data.recipientName)},</p>
    <p>${data.isStudent ? 'Your' : `${esc(data.studentName)}'s`} IGCSE grade has been updated.</p>
    <div class="info-box">
      <table>
        ${!data.isStudent ? `<tr><td>Student</td><td>${esc(data.studentName)}</td></tr>` : ''}
        <tr><td>Previous grade</td><td>${gradeLabel(data.previousGrade)}</td></tr>
        <tr><td>New grade</td><td><strong>${gradeLabel(data.newGrade)}</strong></td></tr>
        <tr><td>Reason</td><td>${esc(data.reason)}</td></tr>
      </table>
    </div>
    ${data.newGrade === null
      ? '<p>Congratulations on completing your IGCSE journey! Your registration features are now disabled, but you can still view your history and manage your escrow balance.</p>'
      : `${actionButton('View Dashboard', `${APP_URL}/dashboard`)}`
    }
  `);

  return sendEmail({
    to,
    subject: `${data.isStudent ? 'Your' : `${data.studentName}'s`} grade updated to ${gradeLabel(data.newGrade)}`,
    html,
  });
}

/** AUTH-003: Student receives an email when a parent sends a link request */
export async function sendLinkRequestEmail(to: string, data: {
  studentName: string;
  parentName: string;
  parentEmail: string;
}): Promise<EmailResult> {
  const html = emailLayout('New Parent Link Request', `
    <h2>New Parent Link Request</h2>
    <p>Hi ${esc(data.studentName)},</p>
    <p><strong>${esc(data.parentName)}</strong> (${esc(data.parentEmail)}) has requested to link to your account as your parent/guardian.</p>
    <p>Review and respond to the request from the <strong>Links</strong> page in your dashboard — you can approve or reject it there.</p>
    ${actionButton('Open Links page', `${APP_URL}/links`)}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
    <p style="font-size:12px;color:#9ca3af;">If you do not recognise this request, you can safely reject it.</p>
  `);

  return sendEmail({ to, subject: `Parent link request from ${data.parentName}`, html });
}

/** AUTH-004: Parent receives an email when a student decides on their link request */
export async function sendLinkDecisionEmail(to: string, data: {
  parentName: string;
  studentName: string;
  approved: boolean;
}): Promise<EmailResult> {
  const decision = data.approved ? 'approved' : 'rejected';
  const colour = data.approved ? '#16a34a' : '#dc2626';
  const html = emailLayout(`Link Request ${data.approved ? 'Approved' : 'Rejected'}`, `
    <h2>Link Request ${data.approved ? 'Approved' : 'Rejected'}</h2>
    <p>Hi ${esc(data.parentName)},</p>
    <p><strong>${esc(data.studentName)}</strong> has <span style="color:${colour};font-weight:600;">${decision}</span> your request to link accounts.</p>
    ${data.approved
      ? '<p>You can now view and manage your child\'s registrations, payments, and escrow balance from your parent dashboard.</p>'
      : '<p>If you believe this is a mistake, you may send a new link request. Please contact support if you need assistance.</p>'
    }
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
    <p style="font-size:12px;color:#9ca3af;">IGCSE Subject Reservation System</p>
  `);

  return sendEmail({ to, subject: `Your link request has been ${decision} by ${data.studentName}`, html });
}

/** NOT-011: Admin sends a bulk announcement */
export async function sendBulkAnnouncementEmail(to: string | string[], data: {
  title: string;
  body: string;
}): Promise<EmailResult> {
  const html = emailLayout(data.title, `
    <h2>${esc(data.title)}</h2>
    <p>${esc(data.body).replace(/\n/g, '<br>')}</p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
    <p style="font-size:12px;color:#9ca3af;">This is an official announcement from the IGCSE administration.</p>
  `);

  return sendEmail({ to, subject: data.title, html });
}

/** AUTH-006: Password reset email */
export async function sendPasswordResetEmail(to: string, data: {
  recipientName: string;
  resetUrl: string;
}): Promise<EmailResult> {
  const html = emailLayout('Reset Your Password', `
    <h2>Password Reset Request</h2>
    <p>Hello ${esc(data.recipientName)},</p>
    <p>We received a request to reset your password. Click the button below to set a new password.</p>
    ${actionButton('Reset Password', data.resetUrl)}
    <p style="font-size:13px;color:#6b7280;margin-top:24px;">This link expires in 24 hours. If you did not request a password reset, you can safely ignore this email.</p>
  `);

  return sendEmail({ to, subject: 'Reset your password — IGCSE System', html });
}

/** AUTH-001/002: Email verification */
export async function sendEmailVerificationEmail(to: string, data: {
  recipientName: string;
  verificationUrl: string;
}): Promise<EmailResult> {
  const html = emailLayout('Verify Your Email', `
    <h2>Welcome to IGCSE Subject Reservation System</h2>
    <p>Hello ${esc(data.recipientName)},</p>
    <p>Thank you for creating your account. Please verify your email address by clicking the button below.</p>
    ${actionButton('Verify Email', data.verificationUrl)}
    <p style="font-size:13px;color:#6b7280;margin-top:24px;">If you did not create an account, you can safely ignore this email.</p>
  `);

  return sendEmail({ to, subject: 'Verify your email — IGCSE System', html });
}

/**
 * RF-08: a finance admin reversed a completed payment. The registration is
 * back to pending payment and any receipt still at the desk is void, so the
 * family must hear about it.
 */
export async function sendPaymentReversedEmail(to: string, data: {
  parentName: string;
  studentName: string;
  amount: number;
  reason: string;
  voidedReceiptNumbers: string[];
  registrationsReverted: number;
}): Promise<EmailResult> {
  const receipts = data.voidedReceiptNumbers.length
    ? `<tr><td>Receipts now void</td><td>${data.voidedReceiptNumbers.map(esc).join(', ')}</td></tr>`
    : '';
  const html = emailLayout('Payment Reversed', `
    <h2>Payment reversed</h2>
    <p>Hello ${esc(data.parentName)},</p>
    <p>The finance office has reversed a payment made for <strong>${esc(data.studentName)}</strong>. The subjects it covered are back to <strong>pending payment</strong> and are not registered until the amount is settled again.</p>
    <div class="info-box">
      <table>
        <tr><td>Student</td><td>${esc(data.studentName)}</td></tr>
        <tr><td>Amount reversed</td><td><strong>EGP ${data.amount.toFixed(2)}</strong></td></tr>
        <tr><td>Registrations affected</td><td>${data.registrationsReverted}</td></tr>
        ${receipts}
        <tr><td>Reason</td><td>${esc(data.reason)}</td></tr>
      </table>
    </div>
    <p>If you hold a paper receipt listed above, it is no longer valid. Please contact the finance desk to settle the registration again.</p>
  `);

  return sendEmail({ to, subject: `Payment reversed — ${data.studentName}`, html });
}

/**
 * A payment notice a parent must act on or know about, sent with its in-app
 * notification: the transfer reference due after a close, a checkout that
 * lapsed without one, a payment closed at the board's entry deadline
 * (owner decision MO-10). One sentence-led body, no table.
 */
export async function sendPaymentNoticeEmail(to: string, data: {
  parentName: string;
  studentName: string;
  title: string;
  body: string;
}): Promise<EmailResult> {
  const html = emailLayout(data.title, `
    <h2>${esc(data.title)}</h2>
    <p>Hello ${esc(data.parentName)},</p>
    <p>${esc(data.body)}</p>
  `);
  return sendEmail({ to, subject: `${data.title} — ${data.studentName}`, html });
}

/**
 * Money audit MA-03: finance rejected an open payment — usually an InstaPay
 * reference that is not on the bank statement. The family must learn why and
 * what to do, since they may believe they have paid.
 */
export async function sendPaymentRejectedEmail(to: string, data: {
  parentName: string;
  studentName: string;
  amount: number;
  escrowReturned: number;
  reason: string;
  registrationsExpired: number;
}): Promise<EmailResult> {
  const escrowRow = data.escrowReturned > 0
    ? `<tr><td>Returned to escrow</td><td>EGP ${data.escrowReturned.toFixed(2)}</td></tr>`
    : '';
  const next = data.registrationsExpired > 0
    ? 'The registration window has closed, so the subjects this payment covered are no longer reserved. If you did send this transfer, contact the finance desk with your bank receipt.'
    : 'The subjects this payment covered are still waiting for payment. If you did send this transfer, contact the finance desk with your bank receipt; otherwise pay again from the app or at the desk.';
  const html = emailLayout('Payment Not Received', `
    <h2>Payment not received</h2>
    <p>Hello ${esc(data.parentName)},</p>
    <p>The finance office could not match a payment for <strong>${esc(data.studentName)}</strong> and has marked it as not received.</p>
    <div class="info-box">
      <table>
        <tr><td>Student</td><td>${esc(data.studentName)}</td></tr>
        <tr><td>Amount</td><td><strong>EGP ${data.amount.toFixed(2)}</strong></td></tr>
        ${escrowRow}
        <tr><td>Reason</td><td>${esc(data.reason)}</td></tr>
      </table>
    </div>
    <p>${next}</p>
  `);

  return sendEmail({ to, subject: `Payment not received — ${data.studentName}`, html });
}
