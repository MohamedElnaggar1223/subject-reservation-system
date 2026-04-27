"use client";

import Link from "next/link";
import { cn } from "~/lib/utils";

/* ------------------------------------------------------------------ */
/*  Geometric pattern rendered purely with CSS divs                   */
/* ------------------------------------------------------------------ */
function GeometricPattern() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.07]">
      {/* Large circle - top right */}
      <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full border-[3px] border-white" />
      {/* Medium circle - bottom left */}
      <div className="absolute -bottom-16 -left-16 h-64 w-64 rounded-full border-[3px] border-white" />
      {/* Diamond rotated */}
      <div className="absolute left-1/2 top-1/3 h-32 w-32 -translate-x-1/2 rotate-45 border-[3px] border-white" />
      {/* Small circles cluster */}
      <div className="absolute right-16 bottom-1/3 h-16 w-16 rounded-full border-[2px] border-white" />
      <div className="absolute right-28 bottom-[38%] h-10 w-10 rounded-full border-[2px] border-white" />
      {/* Horizontal lines */}
      <div className="absolute left-12 top-[60%] h-[2px] w-24 bg-white" />
      <div className="absolute left-12 top-[62%] h-[2px] w-16 bg-white" />
      {/* Dots grid */}
      <div className="absolute right-12 top-16 grid grid-cols-4 gap-3">
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i} className="h-1.5 w-1.5 rounded-full bg-white" />
        ))}
      </div>
      {/* Corner accent lines */}
      <div className="absolute bottom-12 right-12 h-20 w-20 border-b-[3px] border-r-[3px] border-white rounded-br-xl" />
      <div className="absolute top-12 left-12 h-20 w-20 border-t-[3px] border-l-[3px] border-white rounded-tl-xl" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Default left-panel branding content                               */
/* ------------------------------------------------------------------ */
function DefaultBranding() {
  return (
    <div className="relative z-10 flex h-full flex-col justify-between p-10 lg:p-12">
      {/* Logo / brand mark */}
      <div className="animate-fade-up">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20 backdrop-blur-sm">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              className="h-5 w-5 text-white"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5"
              />
            </svg>
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-white">
            IGCSE Reserve
          </span>
        </div>
      </div>

      {/* Center tagline */}
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
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mobile branded header (shown < lg)                                */
/* ------------------------------------------------------------------ */
function MobileHeader() {
  return (
    <div className="relative overflow-hidden bg-brand-gradient px-6 py-8 lg:hidden">
      <GeometricPattern />
      <div className="relative z-10 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/20 backdrop-blur-sm">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            className="h-5 w-5 text-white"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5"
            />
          </svg>
        </div>
        <span className="font-display text-base font-bold tracking-tight text-white">
          IGCSE Reserve
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AuthLayout — the shared split-screen shell                        */
/* ------------------------------------------------------------------ */
interface AuthLayoutProps {
  /** Heading shown above the form on the right panel */
  title: string;
  /** Subtitle / description shown below the heading */
  subtitle?: string;
  /** The form or content for the right panel */
  children: React.ReactNode;
  /** Optional custom content for the left decorative panel */
  decorativeContent?: React.ReactNode;
  /** Additional classes on the right-panel inner wrapper */
  className?: string;
  /** Footer links (e.g. "Already have an account? Sign in") */
  footer?: React.ReactNode;
}

export default function AuthLayout({
  title,
  subtitle,
  children,
  decorativeContent,
  className,
  footer,
}: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* ── Mobile branded header ── */}
      <MobileHeader />

      {/* ── Left decorative panel (desktop) ── */}
      <div className="relative hidden w-[480px] shrink-0 overflow-hidden bg-brand-gradient bg-noise lg:block xl:w-[520px]">
        <GeometricPattern />
        {decorativeContent ?? <DefaultBranding />}
      </div>

      {/* ── Right content panel ── */}
      <div className="flex flex-1 items-center justify-center bg-background px-6 py-10 lg:px-12">
        <div className={cn("w-full max-w-[440px] space-y-8", className)}>
          {/* Title block */}
          <div className="animate-fade-up space-y-2">
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground lg:text-3xl">
              {title}
            </h2>
            {subtitle && (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>

          {/* Form / content */}
          <div className="animate-fade-up stagger-2">{children}</div>

          {/* Footer */}
          {footer && (
            <div className="animate-fade-up stagger-4 text-center text-sm text-muted-foreground">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Re-export sub-components for custom left panels                   */
/* ------------------------------------------------------------------ */
export { GeometricPattern, DefaultBranding, MobileHeader };
