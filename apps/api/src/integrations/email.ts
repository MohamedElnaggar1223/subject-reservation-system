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

// ─── Init ─────────────────────────────────────────────────────────────────────

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const EMAIL_FROM = process.env.EMAIL_FROM ?? 'IGCSE System <noreply@school.com>';
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const STUB_MODE = !resend;

if (STUB_MODE) {
  console.warn('[email] RESEND_API_KEY not set — running in stub mode (no emails sent)');
}

// ─── Core Send ────────────────────────────────────────────────────────────────

export type EmailPayload = {
  to: string | string[];
  subject: string;
  html: string;
};

export type EmailResult = {
  success: boolean;
  messageId?: string;
  stubbed?: boolean;
  error?: string;
};

export async function sendEmail(payload: EmailPayload): Promise<EmailResult> {
  if (STUB_MODE) {
    console.log('[email:stub] To:', payload.to, '| Subject:', payload.subject);
    return { success: true, stubbed: true, messageId: `stub-${Date.now()}` };
  }

  try {
    const result = await resend!.emails.send({
      from: EMAIL_FROM,
      to: Array.isArray(payload.to) ? payload.to : [payload.to],
      subject: payload.subject,
      html: payload.html,
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
  <title>${title}</title>
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
  return `<p><a href="${url}" class="btn">${label}</a></p>`;
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
    <p>Hello ${data.recipientName},</p>
    <p>A new subject registration window has opened. Register before the deadline to secure your subjects.</p>
    <div class="info-box">
      <table>
        <tr><td>Session</td><td><strong>${data.sessionName}</strong></td></tr>
        <tr><td>Type</td><td>${data.sessionType}</td></tr>
        <tr><td>Registration deadline</td><td><strong>${data.deadline}</strong></td></tr>
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
    <p>Hello ${data.recipientName},</p>
    <p>The registration window for <strong>${data.sessionName}</strong> closes in approximately 24 hours.</p>
    <div class="info-box">
      <table>
        <tr><td>Session</td><td><strong>${data.sessionName}</strong></td></tr>
        <tr><td>Deadline</td><td><strong>${data.deadline}</strong></td></tr>
      </table>
    </div>
    ${actionButton('Register Now', `${APP_URL}/register`)}
  `);

  return sendEmail({ to, subject: `Reminder: Registration closes soon — ${data.sessionName}`, html });
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
    .map((s) => `<tr><td>${s.name}</td><td>EGP ${s.price.toFixed(2)}</td></tr>`)
    .join('');

  const html = emailLayout('Registration Request Requires Your Approval', `
    <h2>Your child has submitted a registration request</h2>
    <p>Hello ${data.parentName},</p>
    <p><strong>${data.studentName}</strong> has submitted a registration request for the following subjects. Your approval is required before payment can proceed.</p>
    <div class="info-box">
      <table>
        <tr><td>Session</td><td><strong>${data.sessionName}</strong></td></tr>
        <tr><td>Student</td><td>${data.studentName}</td></tr>
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
    <p>Hello ${data.studentName},</p>
    <p>${intro}</p>
    <div class="info-box">
      <table>
        <tr><td>Session</td><td><strong>${data.sessionName}</strong></td></tr>
        <tr><td>Decision by</td><td>${data.parentName}</td></tr>
        <tr><td>Status</td><td><span class="badge ${badgeClass}">${badgeLabel}</span></td></tr>
        ${data.comments ? `<tr><td>Comments</td><td>${data.comments}</td></tr>` : ''}
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
}): Promise<EmailResult> {
  const subjectList = data.subjects.map((s) => `<li>${s}</li>`).join('');

  const html = emailLayout('Payment Confirmed', `
    <h2>Payment confirmed</h2>
    <p>Hello ${data.parentName},</p>
    <p>Payment for <strong>${data.studentName}</strong>'s registration has been confirmed. The subjects are now fully registered.</p>
    <div class="info-box">
      <table>
        <tr><td>Student</td><td>${data.studentName}</td></tr>
        <tr><td>Session</td><td><strong>${data.sessionName}</strong></td></tr>
        <tr><td>Amount paid</td><td><strong>EGP ${data.amount.toFixed(2)}</strong></td></tr>
        <tr><td>Payment method</td><td>${data.method}</td></tr>
        <tr><td>Reference #</td><td><code>${data.paymentId}</code></td></tr>
      </table>
    </div>
    <p><strong>Registered subjects:</strong></p>
    <ul style="font-size:14px;line-height:1.8;">${subjectList}</ul>
    ${actionButton('View Registrations', `${APP_URL}/registrations`)}
  `);

  return sendEmail({ to, subject: `Payment confirmed — ${data.sessionName}`, html });
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
    ? `swap <strong>${data.subjectName}</strong> for <strong>${data.newSubjectName}</strong>`
    : `drop <strong>${data.subjectName}</strong>`;

  const html = emailLayout('Subject Change Request Requires Approval', `
    <h2>Your child has requested a subject ${verb}</h2>
    <p>Hello ${data.parentName},</p>
    <p><strong>${data.studentName}</strong> has requested to ${changeDesc}. Your approval is required.</p>
    <div class="info-box">
      <table>
        <tr><td>Type</td><td><span class="badge badge-blue">${data.changeType.toUpperCase()}</span></td></tr>
        <tr><td>Subject</td><td>${data.subjectName}</td></tr>
        ${data.newSubjectName ? `<tr><td>New subject</td><td>${data.newSubjectName}</td></tr>` : ''}
        <tr><td>Financial impact</td><td>${data.financialImpact}</td></tr>
        ${data.reason ? `<tr><td>Reason given</td><td>${data.reason}</td></tr>` : ''}
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
    <p>Hello ${data.studentName},</p>
    <div class="info-box">
      <table>
        <tr><td>Request type</td><td>${data.changeType.toUpperCase()}</td></tr>
        <tr><td>Subject</td><td>${data.subjectName}</td></tr>
        ${data.newSubjectName ? `<tr><td>New subject</td><td>${data.newSubjectName}</td></tr>` : ''}
        <tr><td>Decision</td><td><span class="badge ${badgeClass}">${badgeLabel}</span></td></tr>
        <tr><td>Decided by</td><td>${data.parentName}</td></tr>
        <tr><td>Financial impact</td><td>${data.financialImpact}</td></tr>
        ${data.comments ? `<tr><td>Comments</td><td>${data.comments}</td></tr>` : ''}
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
    <h2>Escrow balance updated for ${data.studentName}</h2>
    <p>Hello ${data.parentName},</p>
    <p>Your child's escrow account balance has been updated.</p>
    <div class="info-box">
      <table>
        <tr><td>Student</td><td>${data.studentName}</td></tr>
        <tr><td>Previous balance</td><td>EGP ${data.previousBalance.toFixed(2)}</td></tr>
        <tr><td>Change</td><td><span class="badge ${badgeClass}">${direction}: EGP ${absAmount.toFixed(2)}</span></td></tr>
        <tr><td>New balance</td><td><strong>EGP ${data.newBalance.toFixed(2)}</strong></td></tr>
        <tr><td>Reason</td><td>${data.reason}</td></tr>
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
    <p>Hello ${data.parentName},</p>
    <p>An escrow withdrawal for <strong>${data.studentName}</strong> has been ${partial ? 'partially ' : ''}processed. Please collect from the school office.</p>
    <div class="info-box">
      <table>
        <tr><td>Student</td><td>${data.studentName}</td></tr>
        <tr><td>Amount requested</td><td>EGP ${data.amountRequested.toFixed(2)}</td></tr>
        <tr><td>Amount released</td><td><strong>EGP ${data.amountReleased.toFixed(2)}</strong></td></tr>
        <tr><td>Remaining balance</td><td>EGP ${data.remainingBalance.toFixed(2)}</td></tr>
        ${data.adminNotes ? `<tr><td>Admin notes</td><td>${data.adminNotes}</td></tr>` : ''}
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
  const gradeLabel = (g: number | null) => (g === null ? 'Graduated' : `Grade ${g}`);

  const html = emailLayout(
    `Grade Updated: ${gradeLabel(data.newGrade)}`,
    `
    <h2>${data.isStudent ? 'Your grade has been updated' : `${data.studentName}'s grade has been updated`}</h2>
    <p>Hello ${data.recipientName},</p>
    <p>${data.isStudent ? 'Your' : `${data.studentName}'s`} IGCSE grade has been updated.</p>
    <div class="info-box">
      <table>
        ${!data.isStudent ? `<tr><td>Student</td><td>${data.studentName}</td></tr>` : ''}
        <tr><td>Previous grade</td><td>${gradeLabel(data.previousGrade)}</td></tr>
        <tr><td>New grade</td><td><strong>${gradeLabel(data.newGrade)}</strong></td></tr>
        <tr><td>Reason</td><td>${data.reason}</td></tr>
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
    <p>Hi ${data.studentName},</p>
    <p><strong>${data.parentName}</strong> (${data.parentEmail}) has requested to link to your account as your parent/guardian.</p>
    <p>Please log in to your account to review and respond to this request. You can approve or reject it from your profile settings.</p>
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
    <p>Hi ${data.parentName},</p>
    <p><strong>${data.studentName}</strong> has <span style="color:${colour};font-weight:600;">${decision}</span> your request to link accounts.</p>
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
    <h2>${data.title}</h2>
    <p>${data.body.replace(/\n/g, '<br>')}</p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
    <p style="font-size:12px;color:#9ca3af;">This is an official announcement from the IGCSE administration.</p>
  `);

  return sendEmail({ to, subject: data.title, html });
}
