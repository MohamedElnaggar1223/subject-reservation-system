import { requireSettingsReader } from '~/lib/auth/session';

/** School settings (F0a): each key names who may change it; the API decides. */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireSettingsReader();
  return <>{children}</>;
}
