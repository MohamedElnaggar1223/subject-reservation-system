import { redirect } from "next/navigation";
import { getSession } from "~/lib/auth/session";
import ParentSignUpClient from "./parent-sign-up.client";

export default async function ParentSignUpPage(): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session && session.session) redirect("/");

  return <ParentSignUpClient />;
}
