const priceFormatter = new Intl.NumberFormat('en-EG', {
  style: 'currency',
  currency: 'EGP',
  maximumFractionDigits: 0,
});

export function formatPrice(price: number): string {
  return priceFormatter.format(price);
}

/**
 * A label for a value the API returns as text (a status, a kind): the map's entry, else the value itself.
 * The response keeps its own type — no `as keyof typeof …` on it (F6: the desk's hand-cast responses).
 */
export function labelFor(labels: Readonly<Record<string, string>>, value: string | null | undefined): string {
  return value == null ? '' : labels[value] ?? value;
}
