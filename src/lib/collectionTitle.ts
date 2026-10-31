/**
 * SEO title text for a collection page: "<Name> — Himalayan <Name>".
 * Categories whose name already starts with "Himalayan" (Honey, Ghee, Tea…) must not get the prefix twice —
 * that used to render "Himalayan Honey — Himalayan Himalayan Honey" (audit HOME-019).
 */
export function collectionTitle(name: string): string {
  const n = (name ?? '').trim()
  return `${n} — ${/^himalayan\b/i.test(n) ? n : `Himalayan ${n}`}`
}
