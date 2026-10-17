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
  if (value === undefined || value === null) return defaultValue
  // BUG FIX (audit): the check was an exact 'false' match, so 'False', 'FALSE',
  // ' false' or '0' (any hand-edited / differently-cased DB value) left a
  // section switched ON even though it was meant to be off.
  const v = String(value).trim().toLowerCase()
  return !(v === 'false' || v === '0' || v === 'off' || v === 'no')
}

// Helper: parse a number setting
export function asNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue
  const n = parseFloat(value)
  return isNaN(n) ? defaultValue : n
}

// ── Shipping fallbacks — ONE source of truth (F-02, Oct 2026 audit) ─────────
// pricingService (client AND server), getSiteSettings DEFAULTS, the announcement bar, the trust
// bar, the PDP and the policy pages all used their own hard-coded fallbacks (₹500 here, 0 there,
// ₹799 in marketing copy). These apply ONLY when the admin setting row is missing/blank; the
// live `free_shipping_min` / `flat_shipping_charge` settings always win.
export const FALLBACK_FREE_SHIPPING_MIN = 0   // 0 = every order ships free (matches the live DB row)
export const FALLBACK_FLAT_SHIPPING     = 99

// ── COD switch — ONE definition (F-05, Oct 2026 audit) ───────────────────────
// The checkout UI used `!== 'false'`, the order service `=== 'false'` — so 'False', '0', 'off' or a
// missing row meant different things on the client and the server, and customer-facing copy (the
// /payment page, the PDP, the announcement bar) advertised COD while it was switched off. Unset →
// DISABLED, matching getSiteSettings DEFAULTS (cod_enabled: 'false'). Anything isEnabled() reads as
// off (false/0/off/no, any case) is off.
export function isCodEnabled(settings: { cod_enabled?: string | null } | Record<string, string | undefined>): boolean {
  return isEnabled((settings as { cod_enabled?: string }).cod_enabled ?? undefined, false)
}

/**
 * Keys that exist in the admin's site_settings but are used ONLY by server code. Anything handed to a
 * 'use client' component is serialised into the page's HTML/RSC payload for every visitor, so these must be
 * removed first (PDP audit, security: layout.tsx passed the whole settings object to Header/Footer/CartDrawer/
 * MobileMenu/MobileBottomNav and the PDP buy box, publishing the internal order-notification address).
 * Verified in the codebase: nothing in components/ or hooks/ reads these keys; only app/api/v1/orders/route.ts does.
 */
export const SERVER_ONLY_SETTING_KEYS = ['admin_notify_email', 'order_email_enabled'] as const

export function stripServerOnlySettings<T extends object>(settings: T): T {
  const out: Record<string, unknown> = { ...(settings as Record<string, unknown>) }
  for (const k of SERVER_ONLY_SETTING_KEYS) delete out[k]
  return out as T
}
