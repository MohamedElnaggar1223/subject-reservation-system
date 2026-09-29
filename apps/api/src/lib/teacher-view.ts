/**
 * Teachers' phone numbers and email addresses are staff contact details:
 * the registration picker needs a name, not a way to reach the teacher
 * privately (security audit RF-20). Only the admin, who manages teachers,
 * sees them; everyone else gets them as null so the response keeps one shape.
 *
 * Every route that returns a teacher row goes through this — the teacher
 * list and detail, and a subject's teachers.
 */
export function teacherForViewer<T extends { phone: string | null; email: string | null }>(
  t: T,
  role: string | null | undefined
): T {
  // The staff account a record is linked to (F0a) is the admin's to see too.
  return role === 'admin'
    ? t
    : { ...t, phone: null, email: null, ...('userId' in t ? { userId: null } : {}), ...('account' in t ? { account: null } : {}) };
}
