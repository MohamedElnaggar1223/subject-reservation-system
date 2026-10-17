// Money is written by one formatter, @repo/validations' formatEgp ("EGP 9,850"; "EGP 9,412.50" with piastres): the
// review of 744e553, item 9 — this file's formatPrice dropped the piastres the API's sentences keep.

/**
 * A label for a value the API returns as text (a status, a kind): the map's entry, else the value itself.
 * The response keeps its own type — no `as keyof typeof …` on it (F6: the desk's hand-cast responses).
 */
export function labelFor(labels: Readonly<Record<string, string>>, value: string | null | undefined): string {
  return value == null ? '' : labels[value] ?? value;
}
