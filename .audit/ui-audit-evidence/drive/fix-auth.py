#!/usr/bin/env python3
"""F6 group 7: sign-in and sign-up. One truthful panel for every auth page (the invented
"500+ Active Students / 98% Satisfaction" and "2 min / Secure / Free" figures gone); the
family's words (reserve, pay, wallet) in the cards and the parent's box; errors announced;
chevrons that point the reading direction; the language button clear of the title at a phone;
the unauthorized page and the incomplete link in sentences with a way on. Exact edits, asserted."""
R = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/ui-audit/apps/web/'
A = R + 'app/(auth)/'

def edit(path, pairs):
    s = open(path, encoding='utf-8').read()
    for old, new in pairs:
        n = s.count(old)
        assert n == 1, (path, n, old[:100])
        s = s.replace(old, new)
    open(path, 'w', encoding='utf-8').write(s)

def drop_decorative(path):
    s = open(path, encoding='utf-8').read()
    assert s.count('      decorativeContent={\n') == 1, path
    start = s.index('      decorativeContent={\n')
    end = s.index('      footer={', start)
    s = s[:start] + s[end:]
    open(path, 'w', encoding='utf-8').write(s)

BACK = 'd="M15.75 19.5L8.25 12l7.5-7.5"'
def flip_back(path):
    s = open(path, encoding='utf-8').read()
    olds = [
        'stroke="currentColor" className="h-3.5 w-3.5">\n              <path strokeLinecap="round" strokeLinejoin="round" ' + BACK,
        'stroke="currentColor" className="h-3.5 w-3.5">\n            <path strokeLinecap="round" strokeLinejoin="round" ' + BACK,
    ]
    n = sum(s.count(o) for o in olds)
    assert n == 1, (path, n)
    for o in olds:
        s = s.replace(o, o.replace('className="h-3.5 w-3.5"', 'className="h-3.5 w-3.5 rtl:rotate-180"'))
    open(path, 'w', encoding='utf-8').write(s)

ERR_OLD = '<div className="animate-fade-up rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">'
ERR_NEW = '<div role="alert" className="animate-fade-up rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">'

# ── The shared panel ──
edit(R + 'components/auth-layout.tsx', [
    ("""      {/* Center tagline */}
      <div className="animate-fade-up stagger-2 space-y-4">
        <h1 className="font-display text-3xl font-bold leading-tight text-white lg:text-4xl">
          Your academic
          <br />
          journey starts here.
        </h1>
        <p className="max-w-xs text-sm leading-relaxed text-white/70">
          Reserve your IGCSE subjects with confidence. A seamless registration
          experience built for students and parents.
        </p>
      </div>

      {/* Bottom stats / trust indicators */}
      <div className="animate-fade-up stagger-4 flex gap-8">
        <div>
          <p className="font-display text-2xl font-bold text-white">500+</p>
          <p className="text-xs text-white/60">Active Students</p>
        </div>
        <div>
          <p className="font-display text-2xl font-bold text-white">30+</p>
          <p className="text-xs text-white/60">IGCSE Subjects</p>
        </div>
        <div>
          <p className="font-display text-2xl font-bold text-white">98%</p>
          <p className="text-xs text-white/60">Satisfaction</p>
        </div>
      </div>""",
     """      {/* What the account is for, in the family's words (F6: the figures that stood here —
          "500+ Active Students", "98% Satisfaction" — were invented). */}
      <div className="animate-fade-up stagger-2 space-y-4">
        <h1 className="font-display text-3xl font-bold leading-tight text-white lg:text-4xl">
          The school&apos;s subject reservations, in one place.
        </h1>
        <p className="max-w-xs text-sm leading-relaxed text-white/80">
          One account for the family, in place of a form for every subject.
        </p>
      </div>

      <ul className="animate-fade-up stagger-4 space-y-3">
        {[
          "Reserve each child's subjects",
          'Pay at the school desk or by InstaPay',
          'See every receipt, and what is still owed',
        ].map((point) => (
          <li key={point} className="flex items-center gap-3">
            <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/20">
              <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </span>
            <span className="text-sm text-white/90">{point}</span>
          </li>
        ))}
      </ul>"""),
    # At a phone the language button sat on the title of a long form.
    ("""      <div className="relative flex flex-1 items-center justify-center bg-background px-6 py-10 lg:px-12">""",
     """      <div className="relative flex flex-1 items-center justify-center bg-background px-6 pb-10 pt-16 lg:px-12 lg:py-10">"""),
])

# ── Sign-up: the chooser ──
p = A + 'sign-up/page.tsx'
drop_decorative(p)
edit(p, [
    ("""            <div className="absolute inset-y-0 left-0 w-1 rounded-l-xl bg-primary opacity-0 transition-opacity group-hover:opacity-100" />""",
     """            <div className="absolute inset-y-0 start-0 w-1 rounded-s-xl bg-primary opacity-0 transition-opacity group-hover:opacity-100" />"""),
    ("""            <div className="absolute inset-y-0 left-0 w-1 rounded-l-xl bg-emerald-500 opacity-0 transition-opacity group-hover:opacity-100" />""",
     """            <div className="absolute inset-y-0 start-0 w-1 rounded-s-xl bg-emerald-500 opacity-0 transition-opacity group-hover:opacity-100" />"""),
    ("""                  Register for IGCSE subjects, manage your registrations, and track your escrow balance.""",
     """                  Reserve your own subjects and follow each one until it is paid."""),
    ("""                  Link to your children&apos;s accounts, register subjects on their behalf, and manage escrow transfers.""",
     """                  Link each child&apos;s account, reserve their subjects, and pay at the school desk or by InstaPay."""),
    ("""              <div className="text-muted-foreground/50 transition-all group-hover:text-primary group-hover:translate-x-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">""",
     """              <div aria-hidden className="text-muted-foreground/50 transition-all group-hover:text-primary group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5 rtl:rotate-180">"""),
    ("""              <div className="text-muted-foreground/50 transition-all group-hover:text-emerald-500 group-hover:translate-x-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">""",
     """              <div aria-hidden className="text-muted-foreground/50 transition-all group-hover:text-emerald-500 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5 rtl:rotate-180">"""),
])

# ── Sign-up: the parent ──
p = A + 'sign-up/parent/parent-sign-up.client.tsx'
drop_decorative(p)
flip_back(p)
edit(p, [
    (ERR_OLD, ERR_NEW),
    ("""      subtitle="Create your parent account to manage your children's IGCSE registrations.\"""",
     """      subtitle="Create your account, then link each child and reserve their subjects.\""""),
    ("""                After registration
""", """                After you create the account
"""),
    ("""                  Link your children&apos;s accounts
""", """                  Link each child&apos;s account — your child accepts the link
"""),
    ("""                  Register subjects on their behalf
""", """                  Reserve their subjects
"""),
    ("""                  Manage escrow and payments
""", """                  Pay at the school desk or by InstaPay
"""),
])

# ── Sign-up: the student ──
p = A + 'sign-up/student/student-sign-up.client.tsx'
drop_decorative(p)
flip_back(p)
edit(p, [(ERR_OLD, ERR_NEW)])

# ── Sign-in, forgot, reset, verify ──
edit(A + 'sign-in/page.tsx', [(ERR_OLD, ERR_NEW)])
p = A + 'forgot-password/page.tsx'; flip_back(p); edit(p, [(ERR_OLD, ERR_NEW)])
p = A + 'reset-password/page.tsx'; flip_back(p); edit(p, [(ERR_OLD, ERR_NEW)])
p = A + 'verify-email/page.tsx'; flip_back(p)
edit(p, [
    ("""        title="Missing verification token"
        subtitle="This link appears to be incomplete. Please check your email and click the full verification link.\"""",
     """        title="This link is incomplete"
        subtitle="Open the link in the email again, or copy all of it into the browser.\""""),
])

# ── Unauthorized: a sentence and a way on ──
open(A + 'unauthorized/page.tsx', 'w', encoding='utf-8').write('''import Link from "next/link";
import { buttonVariants } from "~/components/ui/button";

// F6: "Unauthorized" was a code and the page a dead end. A signed-in person who opens a page their
// account cannot use reads why in a sentence and has the way back to their own home.
export default function Unauthorized(): React.JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="font-display text-2xl font-semibold text-foreground">This page is not open to your account</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          It belongs to another part of the school&apos;s work. Your own pages are on your home.
        </p>
        <Link href={"/" as never} className={buttonVariants()}>
          Go to your home
        </Link>
      </div>
    </main>
  );
}
''')
print('ok')
