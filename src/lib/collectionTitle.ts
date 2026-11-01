/**
 * SEO title text for a collection page (the site name is appended by the layout's title template).
 * "Himalayan Honey — Farm-Direct from the Himalayas", "Himalayan Tea — …" ; names that don't start with "Himalayan" get it
 * added ("Rice" -> "Himalayan Rice"). It used to repeat the category name ("Himalayan Honey — Himalayan Honey", audit HOME-019).
 */
export function collectionTitle(name: string): string {
  const n = (name ?? '').trim() || 'Collection'
  const full = /^himalayan\b/i.test(n) ? n : `Himalayan ${n}`
  return `${full} — Farm-Direct from the Himalayas`
}
