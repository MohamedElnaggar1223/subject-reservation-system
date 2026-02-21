import { redirect } from "next/navigation";
import { getSession } from "~/lib/auth/session";
import StudentSignUpClient from "./student-sign-up.client";

export default async function StudentSignUpPage(): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session && session.session) redirect("/");

  return <StudentSignUpClient />;
}
