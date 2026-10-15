// ─────────────────────────────────────────────────────────────────────────────
// lib/confirmationToken.ts  (client-safe — no server imports)
//
// F-01 / F-10 (Oct 2026 checkout audit)
//
// The guest order-confirmation capability token used to travel in the URL
// (/order-success?id=…&token=…). With Google Tag Manager / GA4 live, the
// default page_view reports the FULL page URL, so the order number + token
// (which unlocks the guest's name, phone and address) were sent to a third
// party and sat in browser history, referrers and shared screenshots.
//
// The token now travels in sessionStorage only:
//   • checkout stashes it just before redirecting (stashConfirmationToken),
//   • the confirmation page reads it back (readConfirmationToken),
//   • a LEGACY URL that still carries ?token= (old bookmarks / in-flight
//     sessions during deploy) is absorbed once and scrubbed from the address
//     bar via history.replaceState (absorbUrlToken).
//
// sessionStorage is per-tab and cleared when the tab closes. That is the
// point: a guest who closes the tab loses the capability, and can still use
// /track (order number + phone). A logged-in customer is unaffected — the
// lookup API falls back to the session cookie.
//
// The same scrub also runs as a tiny inline <script> in <head> BEFORE any
// analytics tag loads (see lib/analyticsGuard.ts), so GA4/GTM never see the
// token even for the very first page_view of a legacy URL.
// ─────────────────────────────────────────────────────────────────────────────

const KEY_PREFIX = 'pr_ct:'
const TOKEN_RE   = /^[0-9a-f-]{36}$/i
const ORDER_RE   = /^[A-Za-z0-9-]{4,32}$/

function storageKey(orderNumber: string): string {
  return `${KEY_PREFIX}${orderNumber}`
}

/** Remember the token for this tab. Never throws (private mode, quota, SSR). */
export function stashConfirmationToken(orderNumber: string | null | undefined, token: string | null | undefined): void {
  if (!orderNumber || !token) return
  if (!ORDER_RE.test(orderNumber) || !TOKEN_RE.test(token)) return
  try { window.sessionStorage.setItem(storageKey(orderNumber), token) } catch { /* storage unavailable — page falls back to session auth / /track */ }
}

/** Token previously stashed for this order in this tab, or ''. */
export function readConfirmationToken(orderNumber: string | null | undefined): string {
  if (!orderNumber || !ORDER_RE.test(orderNumber)) return ''
  try {
    const v = window.sessionStorage.getItem(storageKey(orderNumber)) || ''
    return TOKEN_RE.test(v) ? v : ''
  } catch { return '' }
}

/**
 * Legacy-URL absorption. If the current URL still has ?token=…, stash it and
 * remove it from the address bar. Returns the token it found ('' if none).
 * Safe to call repeatedly and on the server (no-op).
 */
export function absorbUrlToken(orderNumber: string | null | undefined): string {
  if (typeof window === 'undefined') return ''
  try {
    const url = new URL(window.location.href)
    const t = url.searchParams.get('token')
    if (t === null) return ''
    if (TOKEN_RE.test(t)) stashConfirmationToken(orderNumber ?? url.searchParams.get('id') ?? url.searchParams.get('num'), t)
    url.searchParams.delete('token')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    return TOKEN_RE.test(t) ? t : ''
  } catch { return '' }
}

/** Token to use for a lookup: a legacy URL token wins (and is scrubbed), else the stash. */
export function resolveConfirmationToken(orderNumber: string | null | undefined): string {
  return absorbUrlToken(orderNumber) || readConfirmationToken(orderNumber)
}

// F-10 (Oct 2026 audit): the guest confirmation token used to be valid forever. It now expires
// CONFIRMATION_TOKEN_TTL_DAYS after the order was created. Computed from orders.created_at, so no
// schema change (and no deploy-ordering risk) is needed. After expiry a guest uses /track
// (order number + phone); a logged-in customer is unaffected (session path in the lookup route).
// Lives here, not in the route file, because Next.js route modules may only export HTTP handlers.
export const CONFIRMATION_TOKEN_TTL_DAYS = 30
export const CONFIRMATION_TOKEN_TTL_MS   = CONFIRMATION_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000

export function isConfirmationTokenExpired(createdAt: unknown, now: number = Date.now()): boolean {
  if (typeof createdAt !== 'string' && typeof createdAt !== 'number') return true // unknown age → fail closed
  const t = new Date(createdAt).getTime()
  if (!Number.isFinite(t)) return true
  return now - t > CONFIRMATION_TOKEN_TTL_MS
}

export const __test = { KEY_PREFIX, TOKEN_RE, ORDER_RE }
