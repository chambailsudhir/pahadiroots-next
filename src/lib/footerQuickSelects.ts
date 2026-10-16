// ─────────────────────────────────────────────────────────────────────────────
// lib/footerQuickSelects.ts  (client-safe, pure)
//
// The footer's "Quick Selects" column used to be a hard-coded list (Wild Honey, A2 Bilona Ghee,
// Himalayan Spices, Ladakhi Shilajit, Himalayan Teas, Ancient Grains) that never matched the
// categories the owner actually manages in admin — names, order and even which products exist
// drifted (there is no "Ancient Grains" category; the rice category is "Heritage Rice").
//
// It is now built from the ADMIN categories (active ones, in the admin's sort order — the same data
// that drives the header's Shop menu), so adding, renaming, re-ordering or deactivating a category in
// admin updates the footer automatically. The old list is kept ONLY as a fallback for the case where
// categories could not be loaded at all.
//
// Optional admin setting `footer_quick_selects_count` (1–12, default 6) sets how many to show.
// ─────────────────────────────────────────────────────────────────────────────

export type QuickKind = 'honey' | 'ghee' | 'saffron' | 'stone' | 'tea' | 'grain'

export interface FooterCategory { name: string; slug: string; emoji?: string | null }
export interface QuickSelect    { kind: QuickKind; emoji: string; label: string; href: string }

export const DEFAULT_QUICK_SELECTS_COUNT = 6

const KIND_EMOJI: Record<QuickKind, string> = {
  honey: '🍯', ghee: '🧈', saffron: '🌶️', stone: '🪨', tea: '🍃', grain: '🌾',
}

/** Picks the footer icon for a category from its slug/name (the icon set is fixed; admin owns the text). */
export function kindForCategory(slug: string, name = ''): QuickKind {
  const s = `${slug} ${name}`.toLowerCase()
  if (/honey|jam|preserve/.test(s))                   return 'honey'
  if (/ghee|oil|butter/.test(s))                      return 'ghee'
  if (/shilajit|stone|resin/.test(s))                 return 'stone'
  if (/\btea\b|chai|juice|drink|kahwa/.test(s))       return 'tea'
  if (/rice|grain|pulse|dal\b|millet|flour|wheat/.test(s)) return 'grain'
  return 'saffron' // spices, herbs, and anything new — a neutral botanical icon
}

export const FALLBACK_QUICK_SELECTS: readonly QuickSelect[] = [
  { kind: 'honey',   emoji: '🍯', label: 'Himalayan Honey',  href: '/collections/himalayan-honey' },
  { kind: 'ghee',    emoji: '🧈', label: 'Himalayan Ghee',   href: '/collections/himalayan-ghee' },
  { kind: 'saffron', emoji: '🌶️', label: 'Herbs & Spices',   href: '/collections/herbs-and-spices' },
  { kind: 'stone',   emoji: '🪨', label: 'Shilajit',         href: '/collections/shilajit' },
  { kind: 'tea',     emoji: '🍃', label: 'Himalayan Tea',    href: '/collections/himalayan-tea' },
  { kind: 'grain',   emoji: '🌾', label: 'Heritage Rice',    href: '/collections/heritage-rice' },
]

function resolveCount(raw: string | null | undefined): number {
  const n = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n)) return DEFAULT_QUICK_SELECTS_COUNT
  return Math.min(12, Math.max(1, n))
}

export function quickSelects(
  categories: ReadonlyArray<FooterCategory> | null | undefined,
  settings?: { footer_quick_selects_count?: string | null } | Record<string, string | undefined>,
): QuickSelect[] {
  const limit = resolveCount((settings as { footer_quick_selects_count?: string } | undefined)?.footer_quick_selects_count)
  const seen = new Set<string>()
  const out: QuickSelect[] = []
  for (const c of categories ?? []) {
    const name = String(c?.name ?? '').trim()
    const slug = String(c?.slug ?? '').trim()
    // Slug becomes part of a URL path: only plain slugs are linked.
    if (!name || !/^[a-z0-9][a-z0-9-]*$/i.test(slug) || seen.has(slug)) continue
    seen.add(slug)
    const kind  = kindForCategory(slug, name)
    const emoji = String(c.emoji ?? '').trim() || KIND_EMOJI[kind]
    out.push({ kind, emoji, label: name, href: `/collections/${slug}` })
    if (out.length >= limit) break
  }
  return out.length > 0 ? out : FALLBACK_QUICK_SELECTS.slice(0, limit)
}
