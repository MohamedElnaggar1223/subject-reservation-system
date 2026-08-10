'use client';

/**
 * Admin Team Client (UX_AUDIT G7)
 *
 * One form creates any account (staff, student, parent); the grid shows
 * everyone with an inline role selector. Staff-first: defaults to
 * showing the team, one click to see students/parents.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, ROLES } from '@repo/validations';
import { Button } from '~/components/ui/button';

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string | null;
  grade: number | null;
  studentId: string | null;
  banned: boolean | null;
  createdAt: string;
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  finance_admin: 'Finance Admin',
  finance_officer: 'Finance Officer',
  parent: 'Parent',
  student: 'Student',
};

const STAFF_ROLES = ['admin', 'finance_admin', 'finance_officer'];

const emptyForm = {
  name: '',
  email: '',
  password: '',
  role: 'finance_officer' as (typeof ROLES)[keyof typeof ROLES],
  grade: '' as '' | '10' | '11' | '12',
};

export default function TeamAdminClient(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'staff' | 'students' | 'parents'>('staff');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState('');

  const { data: users = [], isLoading } = useQuery<UserRow[]>({
    queryKey: ['users', 'admin', search],
    queryFn: async () =>
      (await apiResponse(
        api.v1.users.$get({ query: { search: search || undefined } })
      )) as UserRow[],
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.users.$post({
          json: {
            name: form.name.trim(),
            email: form.email.trim(),
            password: form.password,
            role: form.role,
            grade: form.role === 'student' && form.grade ? (Number(form.grade) as 10 | 11 | 12) : undefined,
          },
        })
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setMessage(`Account created for ${form.email}. Share the temporary password with them directly.`);
      setForm(emptyForm);
      setFormError('');
    },
    onError: (err: Error) => { setFormError(err.message); setMessage(''); },
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      apiResponse(
        api.v1.users[':id'].$put({
          param: { id },
          json: { role: role as 'admin' },
        })
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
    onError: (err: Error) => setFormError(err.message),
  });

  const visible = users.filter((u) => {
    if (tab === 'staff') return STAFF_ROLES.includes(u.role ?? '');
    if (tab === 'students') return u.role === 'student';
    return u.role === 'parent';
  });

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto animate-fade-up">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">Team &amp; Accounts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create accounts and assign roles. Finance officers run the desk; finance admins also
          approve refunds, grant exceptions, and manage fee schedules.
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
          createMutation.mutate();
        }}
        className="bg-card rounded-xl border border-border shadow-sm p-5 mb-6"
      >
        <div className="grid gap-3 sm:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Temp. password</label>
            <input
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Min 8, 1 upper, 1 digit"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Role</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as typeof form.role })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          {form.role === 'student' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Grade</label>
              <select
                value={form.grade}
                onChange={(e) => setForm({ ...form, grade: e.target.value as typeof form.grade })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="">Pick…</option>
                <option value="10">Grade 10</option>
                <option value="11">Grade 11</option>
                <option value="12">Grade 12</option>
              </select>
            </div>
          )}
        </div>
        {formError && <p className="mt-3 text-sm text-destructive">{formError}</p>}
        {message && <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
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
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Email</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Role</th>
                {tab === 'students' && (
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Grade / ID</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((u) => (
                <tr key={u.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{u.name}</td>
                  <td className="px-4 py-3 text-card-foreground">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role ?? 'user'}
                      onChange={(e) => {
                        const newRole = e.target.value;
                        if (
                          confirm(`Change ${u.name}'s role to ${ROLE_LABELS[newRole] ?? newRole}?`)
                        ) {
                          roleMutation.mutate({ id: u.id, role: newRole });
                        }
                      }}
                      disabled={roleMutation.isPending}
                      className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                    >
                      {Object.entries(ROLE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                      {!Object.keys(ROLE_LABELS).includes(u.role ?? '') && (
                        <option value={u.role ?? 'user'}>{u.role ?? 'no role'}</option>
                      )}
                    </select>
                  </td>
                  {tab === 'students' && (
                    <td className="px-4 py-3 text-card-foreground">
                      {u.grade ? `G${u.grade}` : 'Graduated'}
                      {u.studentId && <span className="text-xs text-muted-foreground font-mono ml-2">{u.studentId}</span>}
                    </td>
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
