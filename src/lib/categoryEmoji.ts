// ─────────────────────────────────────────────────────────────────────────────
// lib/categoryEmoji.ts
//
// BUG FIX (P2, homepage audit): CategoryTiles.tsx had a correct emojiFor()
// that returns real emoji characters. BestSellersClient.tsx independently
// implemented its own catEmoji() that — despite the name — returned a TEXT
// LABEL ("Honey", "Ghee", "Grain"...), not an emoji. Since the filter
// buttons render `{cat.emoji || catEmoji(cat.name)} {cat.name}`, any
// category without a DB-set emoji rendered its name twice, e.g. a "Honey"
// category button literally read "Honey Honey".
//
// Fix: one shared implementation (this file, based on the CategoryTiles
// version, which was already correct) used by both components instead of
// two independent implementations that can silently diverge again later.
// ─────────────────────────────────────────────────────────────────────────────

interface CategoryLike { slug?: string | null; name?: string | null }

export function emojiForCategory(cat: CategoryLike): string {
  const slug = (cat.slug || '').toLowerCase()
  const name = (cat.name || '').toLowerCase()
  const bySlug: Record<string, string> = {
    honey: '🍯', jams: '🍓', juice: '🧃', oil: '🫚',
    pulses: '🫘', rice: '🌾', shilajit: '🪨', spices: '🌿', tea: '🍵',
  }
  if (bySlug[slug]) return bySlug[slug]
  if (name.includes('honey'))  return '🍯'
  if (name.includes('ghee'))   return '🥛'
  if (name.includes('herb') || name.includes('spice')) return '🌿'
  if (name.includes('tea'))    return '🍵'
  if (name.includes('rice') || name.includes('grain') || name.includes('millet')) return '🌾'
  if (name.includes('oil'))    return '🫙'
  if (name.includes('juice'))  return '🧃'
  if (name.includes('shilajit') || name.includes('resin')) return '🪨'
  if (name.includes('jam') || name.includes('preserve')) return '🍓'
  if (name.includes('pulse') || name.includes('dal')) return '🫘'
  if (name.includes('coffee')) return '☕'
  if (name.includes('saffron')) return '🌸'
  return '🏔️'
}
