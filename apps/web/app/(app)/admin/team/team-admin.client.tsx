'use client';

/**
 * Admin Team Client (UX_AUDIT G7, F0a)
 *
 * One form creates any account (staff, student, parent); the grid shows
 * everyone with an inline role selector. Staff-first: defaults to showing
 * the team, one click to see students/parents.
 *
 * F0a: the coordinator, teacher and gate roles; teaching is a capability —
 * any staff account can teach as a teacher record, linked here when the
 * account is made or later from its row; a student's grade is the grade
 * this academic year (the cohort is stored) and the grid shows where each
 * student stands.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, gradeLabel, gradeStanding, ROLE_LABELS, STAFF_ROLES, type Role } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { StandingBadge } from '~/components/ui/tone';

// Typed by the API, never by hand (CLAUDE.md: Hono RPC everywhere).
const fetchUsers = (search: string) => apiResponse(api.v1.users.$get({ query: { search: search || undefined } }));
const fetchTeachers = () => apiResponse(api.v1.teachers.$get({ query: {} }));
type UserRow = Awaited<ReturnType<typeof fetchUsers>>[number];

const ROLE_OPTIONS = Object.entries(ROLE_LABELS) as [Role, string][];
const isStaff = (role: string | null) => (STAFF_ROLES as readonly string[]).includes(role ?? '');

// What each staff role does — shown under the form so the admin picks the right one.
const ROLE_HINTS: Partial<Record<Role, string>> = {
  finance_officer: 'Runs the desk: payments, receipts and registrations on a family’s behalf.',
  finance_admin: 'The desk, plus refunds, exceptions and fee schedules.',
  coordinator: 'The academic lead: calendar, sections, the student record and grade-10 exceptions.',
  teacher: 'Their own teaching. Needs a teacher record — pick one or create one.',
  gate: 'Reception and security: the school day and, later, the leave list.',
  admin: 'Everything, except what only a parent may do for their own family.',
};

// '' = does not teach; 'new' = a new teacher record from this account; else a record id.
type TeachChoice = '' | 'new' | string;

const emptyForm = {
  name: '',
  email: '',
  password: '',
  role: 'finance_officer' as Role,
  grade: '' as '' | '9' | '10' | '11' | '12',
  teaches: '' as TeachChoice,
};

export default function TeamAdminClient(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'staff' | 'students' | 'parents'>('staff');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState('');
  const [rowError, setRowError] = useState('');

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users', 'admin', search],
    queryFn: () => fetchUsers(search),
  });
  const { data: teachers = [] } = useQuery({
    queryKey: ['teachers', 'team'],
    queryFn: fetchTeachers,
  });
  // Records free to link: active and not already an account's.
  const freeTeachers = useMemo(() => teachers.filter((t) => t.isActive && !t.userId), [teachers]);

  const createMutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.users.$post({
          json: {
            name: form.name.trim(),
            email: form.email.trim(),
            password: form.password,
            role: form.role,
            grade: form.role === 'student' && form.grade ? (Number(form.grade) as 9 | 10 | 11 | 12) : undefined,
            ...(isStaff(form.role) && form.teaches === 'new' ? { newTeacherRecord: true } : {}),
            ...(isStaff(form.role) && form.teaches && form.teaches !== 'new' ? { teacherId: form.teaches } : {}),
          },
        })
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['teachers'] });
      setMessage(`Account created for ${form.email}. Share the temporary password with them directly.`);
      setForm(emptyForm);
      setFormError('');
    },
    onError: (err: Error) => { setFormError(err.message); setMessage(''); },
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      apiResponse(api.v1.users[':id'].$put({ param: { id }, json: { role } })),
    onSuccess: () => { setRowError(''); queryClient.invalidateQueries({ queryKey: ['users'] }); },
    onError: (err: Error) => setRowError(err.message),
  });

  // Link a staff account to a teacher record, or unlink it (userId null).
  const linkMutation = useMutation({
    mutationFn: ({ teacherId, userId }: { teacherId: string; userId: string | null }) =>
      apiResponse(api.v1.teachers[':id'].account.$put({ param: { id: teacherId }, json: { userId } })),
    onSuccess: () => {
      setRowError('');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['teachers'] });
    },
    onError: (err: Error) => setRowError(err.message),
  });

  const visible = users.filter((u) => {
    if (tab === 'staff') return isStaff(u.role);
    if (tab === 'students') return u.role === 'student';
    return u.role === 'parent';
  });

  const staffForm = isStaff(form.role);

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto animate-fade-up">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">Team &amp; Accounts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create accounts and assign roles. Anyone on the staff can also teach: link their account to a
          teacher record and they get the teaching screens for their own lessons.
        </p>
      </div>

      {/* Create form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setFormError('');
          if (!form.name.trim() || !form.email.trim() || !form.password) {
            setFormError('Name, email, and a temporary password are required.');
            return;
          }
          if (form.role === 'student' && !form.grade) {
            setFormError('Students need a grade.');
            return;
          }
          if (form.role === 'teacher' && !form.teaches) {
            setFormError('A teacher account teaches as a teacher record: pick one, or create one.');
            return;
          }
          createMutation.mutate();
        }}
        className="bg-card rounded-xl border border-border shadow-sm p-5 mb-6"
      >
        <div className="grid gap-3 sm:grid-cols-5">
          <div>
            <label htmlFor="team-name" className="mb-1 block text-xs font-medium text-foreground">Name</label>
            <input
              id="team-name"
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>
          <div>
            <label htmlFor="team-email" className="mb-1 block text-xs font-medium text-foreground">Email</label>
            <input
              id="team-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>
          <div>
            <label htmlFor="team-password" className="mb-1 block text-xs font-medium text-foreground">Temp. password</label>
            <input
              id="team-password"
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Min 8, 1 upper, 1 digit"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div>
            <label htmlFor="team-role" className="mb-1 block text-xs font-medium text-foreground">Role</label>
            <select
              id="team-role"
              value={form.role}
              onChange={(e) => {
                const role = e.target.value as Role;
                // A teacher account needs a record: default to making one.
                setForm({ ...form, role, teaches: role === 'teacher' && !form.teaches ? 'new' : isStaff(role) ? form.teaches : '' });
              }}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {ROLE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          {form.role === 'student' && (
            <div>
              <label htmlFor="team-grade" className="mb-1 block text-xs font-medium text-foreground">Grade this year</label>
              <select
                id="team-grade"
                value={form.grade}
                onChange={(e) => setForm({ ...form, grade: e.target.value as typeof form.grade })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="">Pick…</option>
                <option value="9">Grade 9 (starts grade 10 next year)</option>
                <option value="10">Grade 10</option>
                <option value="11">Grade 11</option>
                <option value="12">Grade 12</option>
              </select>
            </div>
          )}
          {staffForm && (
            <div>
              <label htmlFor="team-teaches" className="mb-1 block text-xs font-medium text-foreground">Teaches as</label>
              <select
                id="team-teaches"
                value={form.teaches}
                onChange={(e) => setForm({ ...form, teaches: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                {form.role !== 'teacher' && <option value="">Does not teach</option>}
                <option value="new">New teacher record (this name)</option>
                {freeTeachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        {ROLE_HINTS[form.role] && <p className="mt-3 text-xs text-muted-foreground">{ROLE_HINTS[form.role]}</p>}
        {formError && <p className="mt-3 text-sm text-destructive" role="alert">{formError}</p>}
        {message && <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400" role="status">{message}</p>}
        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating…' : 'Create Account'}
          </Button>
        </div>
      </form>

      {/* Tabs + search */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex rounded-lg border border-border overflow-hidden text-sm">
          {(['staff', 'students', 'parents'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 capitalize transition-colors ${
                tab === t ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground hover:bg-muted'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          className="flex-1 min-w-[200px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {rowError && <p className="mb-3 text-sm text-destructive" role="alert">{rowError}</p>}

      {/* Grid */}
      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center shadow-sm">
          <p className="text-muted-foreground text-sm">No accounts here yet.</p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th className="px-4 py-3 text-start font-semibold text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-start font-semibold text-muted-foreground">Email</th>
                <th className="px-4 py-3 text-start font-semibold text-muted-foreground">Role</th>
                {tab === 'staff' && (
                  <th className="px-4 py-3 text-start font-semibold text-muted-foreground">Teaches as</th>
                )}
                {tab === 'students' && (
                  <>
                    <th className="px-4 py-3 text-start font-semibold text-muted-foreground">Grade / ID</th>
                    <th className="px-4 py-3 text-start font-semibold text-muted-foreground">Standing</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((u) => (
                <tr key={u.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {u.role === 'student'
                      ? <Link href={`/students/${u.id}` as never} className="hover:underline">{u.name}</Link>
                      : u.name}
                  </td>
                  <td className="px-4 py-3 text-card-foreground">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      aria-label={`Role of ${u.name}`}
                      value={u.role ?? 'user'}
                      onChange={(e) => {
                        const newRole = e.target.value as Role;
                        if (newRole === 'teacher' && !u.teachingAs) {
                          setRowError('Link this account to a teacher record first (Teaches as), then make it a teacher.');
                          return;
                        }
                        if (confirm(`Change ${u.name}'s role to ${ROLE_LABELS[newRole] ?? newRole}?`)) {
                          roleMutation.mutate({ id: u.id, role: newRole });
                        }
                      }}
                      disabled={roleMutation.isPending}
                      className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                    >
                      {ROLE_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                      {!ROLE_OPTIONS.some(([value]) => value === u.role) && (
                        <option value={u.role ?? 'user'}>{u.role ?? 'no role'}</option>
                      )}
                    </select>
                  </td>
                  {tab === 'staff' && (
                    <td className="px-4 py-3">
                      {u.teachingAs ? (
                        <div className="flex items-center gap-2">
                          <span className="text-card-foreground">{u.teachingAs.name}</span>
                          <button
                            type="button"
                            className="text-xs text-primary underline hover:no-underline disabled:opacity-50"
                            disabled={linkMutation.isPending || u.role === 'teacher'}
                            title={u.role === 'teacher' ? 'A teacher account keeps its record: change the role first' : undefined}
                            onClick={() => {
                              if (confirm(`Stop ${u.name} teaching as ${u.teachingAs!.name}? The teacher record stays.`)) {
                                linkMutation.mutate({ teacherId: u.teachingAs!.id, userId: null });
                              }
                            }}
                          >
                            Unlink
                          </button>
                        </div>
                      ) : (
                        <select
                          aria-label={`Teacher record for ${u.name}`}
                          value=""
                          disabled={linkMutation.isPending || freeTeachers.length === 0}
                          onChange={(e) => {
                            const teacherId = e.target.value;
                            const t = freeTeachers.find((x) => x.id === teacherId);
                            if (t && confirm(`Link ${u.name} to the teacher record ${t.name}?`)) {
                              linkMutation.mutate({ teacherId, userId: u.id });
                            }
                          }}
                          className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-muted-foreground"
                        >
                          <option value="">{freeTeachers.length === 0 ? 'No unlinked record' : 'Does not teach — link…'}</option>
                          {freeTeachers.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      )}
                    </td>
                  )}
                  {tab === 'students' && (
                    <>
                      <td className="px-4 py-3 text-card-foreground">
                        {gradeLabel(u.grade)}
                        {u.studentId && <span className="text-xs text-muted-foreground font-mono ms-2">{u.studentId}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <StandingBadge standing={u.leftKind ?? gradeStanding(u.grade)} />
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
