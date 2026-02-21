import { redirect } from "next/navigation";
import { getSession } from "~/lib/auth/session";
import ProfileClient from "./profile.client";

export default async function ProfilePage(): Promise<React.JSX.Element> {
  const session = await getSession();

  if (!session || !session.session) {
    redirect("/sign-in");
  }

  return <ProfileClient />;
}
