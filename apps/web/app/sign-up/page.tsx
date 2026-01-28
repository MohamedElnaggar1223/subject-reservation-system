import { redirect } from "next/navigation";
import SignUpPageClient from "./sign-up.page";
import { getSession } from "~/lib/auth/session";

export default async function SignUpPage(): Promise<React.JSX.Element> {
  const session = await getSession()

  if(session && session.session) redirect("/")

  return <SignUpPageClient />
}