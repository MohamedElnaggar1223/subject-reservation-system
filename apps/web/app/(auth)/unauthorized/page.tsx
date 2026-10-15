import Link from "next/link";
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
