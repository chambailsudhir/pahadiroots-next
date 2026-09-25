// ── Client-safe site-settings helpers ──────────────────────────────────────
// Split out of getSiteSettings.ts (Oct 2026 build fix) — that file imports
// `revalidateTag`/`unstable_cache` from 'next/cache', which are server-only
// APIs. Header.tsx and MobileMenu.tsx are 'use client' components that only
// ever needed isEnabled(), but because it used to live in the same physical
// file as the next/cache import, importing it pulled the whole module,
// next/cache included, into the client bundle. Turbopack correctly refuses
// to bundle that, which is what broke the Vercel build.
//
// These two functions have zero server dependencies, so they're safe here.
// getSiteSettings.ts re-exports both from this file for every existing
// server-side importer (about/page.tsx, checkout, API routes, etc.), so
// nothing else needed to change.
// ─────────────────────────────────────────────────────────────────────────────

// Helper: parse a boolean setting (handles 'true', 'false', missing)
export function isEnabled(value: string | undefined, defaultValue = true): boolean {
  if (value === undefined) return defaultValue
  return value !== 'false'
}

// Helper: parse a number setting
export function asNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue
  const n = parseFloat(value)
  return isNaN(n) ? defaultValue : n
}
