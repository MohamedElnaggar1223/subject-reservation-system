import { redirect } from "next/navigation";
import { getSession } from "~/lib/auth/session";
import LinksClient from "./links.client";

export default async function LinksPage(): Promise<React.JSX.Element> {
  const session = await getSession();

  if (!session || !session.session) {
    redirect("/sign-in");
  }

  return <LinksClient />;
}
