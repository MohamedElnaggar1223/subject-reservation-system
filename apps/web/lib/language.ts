/**
 * The reader's language, kept in a cookie so the server renders each page in it (app/layout.tsx) and
 * the browser's first render agrees (lib/i18n.tsx). A plain module, not a client one: the root layout
 * (a server component) reads it.
 */
export const LANGUAGE_COOKIE = 'language';

export function languageFrom(value: string | null | undefined): 'en' | 'ar' {
  return value === 'ar' ? 'ar' : 'en';
}
