// Nov 2026 verification: admin/autopilot meta titles already end in "| HimVeda" (or "| HimVeda by Pahadi Roots"), and the root
// layout's title.template appends " | HimVeda by Pahadi Roots" again → "… | HimVeda | HimVeda by Pahadi Roots". Strip any
// trailing "| HimVeda…" brand suffix (repeated ones too) so the template adds the brand exactly once.
const TRAILING_BRAND = /(?:\s*[|｜]\s*HimVeda\b[^|｜]*)+$/i

export function blogMetaTitle(metaTitle: string | null | undefined, fallback: string): string {
  const stripped = String(metaTitle ?? '').replace(TRAILING_BRAND, '').trim()
  return stripped || String(fallback ?? '').replace(TRAILING_BRAND, '').trim() || 'Blog'
}
