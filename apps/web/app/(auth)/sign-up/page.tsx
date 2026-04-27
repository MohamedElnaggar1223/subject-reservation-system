import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "~/lib/auth/session";
import AuthLayout from "~/components/auth-layout";

export default async function SignUpPage(): Promise<React.JSX.Element> {
  const session = await getSession();

  // Only redirect if the user already has a proper role (not the default 'user')
  if (session && session.session && session.user.role && session.user.role !== 'user') {
    redirect("/");
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Choose your account type to get started with IGCSE subject reservations."
      decorativeContent={
        <div className="relative z-10 flex h-full flex-col justify-between p-10 lg:p-12">
          <div className="animate-fade-up">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20 backdrop-blur-sm">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5 text-white">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5" />
                </svg>
              </div>
              <span className="font-display text-lg font-bold tracking-tight text-white">IGCSE Reserve</span>
            </div>
          </div>

          <div className="animate-fade-up stagger-2 space-y-4">
            <h1 className="font-display text-3xl font-bold leading-tight text-white lg:text-4xl">
              Join our academic
              <br />
              community.
            </h1>
            <p className="max-w-xs text-sm leading-relaxed text-white/70">
              Whether you are a student or a parent, we have got you covered
              with a seamless registration experience.
            </p>
          </div>

          <div className="animate-fade-up stagger-4 flex gap-8">
            <div>
              <p className="font-display text-2xl font-bold text-white">2 min</p>
              <p className="text-xs text-white/60">Quick Setup</p>
            </div>
            <div>
              <p className="font-display text-2xl font-bold text-white">Secure</p>
              <p className="text-xs text-white/60">Data Protected</p>
            </div>
            <div>
              <p className="font-display text-2xl font-bold text-white">Free</p>
              <p className="text-xs text-white/60">To Register</p>
            </div>
          </div>
        </div>
      }
      footer={
        <p>
          Already have an account?{" "}
          <Link
            href={"/sign-in" as never}
            className="font-medium text-primary hover:text-primary/80 transition-colors"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <div className="grid gap-4">
        {/* Student Card */}
        <Link href={"/sign-up/student" as never} className="group">
          <div className="relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm transition-all duration-200 hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5">
            {/* Teal accent bar */}
            <div className="absolute inset-y-0 left-0 w-1 rounded-l-xl bg-primary opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-primary transition-colors group-hover:bg-brand-100">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="h-6 w-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5"
                  />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-display text-base font-semibold text-foreground">
                  I&apos;m a Student
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Register for IGCSE subjects, manage your registrations, and track your escrow balance.
                </p>
              </div>
              <div className="text-muted-foreground/50 transition-all group-hover:text-primary group-hover:translate-x-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </div>
            </div>
          </div>
        </Link>

        {/* Parent Card */}
        <Link href={"/sign-up/parent" as never} className="group">
          <div className="relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm transition-all duration-200 hover:border-emerald-400/30 hover:shadow-md hover:-translate-y-0.5">
            {/* Emerald accent bar */}
            <div className="absolute inset-y-0 left-0 w-1 rounded-l-xl bg-emerald-500 opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 transition-colors group-hover:bg-emerald-100">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="h-6 w-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
                  />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-display text-base font-semibold text-foreground">
                  I&apos;m a Parent
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Link to your children&apos;s accounts, register subjects on their behalf, and manage escrow transfers.
                </p>
              </div>
              <div className="text-muted-foreground/50 transition-all group-hover:text-emerald-500 group-hover:translate-x-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </div>
            </div>
          </div>
        </Link>
      </div>
    </AuthLayout>
  );
}
