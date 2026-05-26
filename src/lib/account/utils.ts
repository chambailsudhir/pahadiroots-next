// ─────────────────────────────────────────────────────────────
// Shared utility functions for account module
// ─────────────────────────────────────────────────────────────

import { COURIER_TRACKING_MAP } from './constants'

// ── SavedAddress shape ────────────────────────────────────────
// Single source of truth for the address object that flows between
// the API (profile/route.ts), hooks (useAddresses, useProfile),
// and UI (AddressSection, SavedAddressSelector).
// Keep this in sync with the `saved_addresses` table columns.
export interface SavedAddress {
  id:    string   // crypto.randomUUID() generated on the client
  label: string   // 'Home' | 'Office' | … (from ADDRESS_LABELS)
  name:  string   // contact name (optional in form, defaults to '')
  addr:  string   // street / flat / colony
  city:  string
  state: string
  pin:   string   // 6-digit pincode (may be empty string if not set)
}

// Type-guard: returns true only if `raw` has the minimum required
// shape (id + addr). Other fields default to '' below rather than
// filtering the entire address out — a missing label or city is
// recoverable; a missing id or addr is not.
function isAddressLike(raw: unknown): raw is Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const a = raw as Record<string, unknown>
  return typeof a.id === 'string' && a.id.length > 0 &&
         typeof a.addr === 'string'
}

// ── Safe localStorage wrapper ────────────────────────────────────────────────
// Guards against SSR (window undefined), private-browsing quota errors, and
// any other storage exceptions — all of which are non-fatal for cache keys.
export const safeLocalStorage = {
  remove(key: string): void {
    if (typeof window === 'undefined') return
    try { localStorage.removeItem(key) } catch { /* non-fatal */ }
  },
  get(key: string): string | null {
    if (typeof window === 'undefined') return null
    try { return localStorage.getItem(key) } catch { return null }
  },
  set(key: string, value: string): void {
    if (typeof window === 'undefined') return
    try { localStorage.setItem(key, value) } catch { /* non-fatal */ }
  },
}

// Parses the `saved_addresses` JSON string from the customer profile.
// - Returns SavedAddress[] (never `any`, never throws to caller).
// - Filters out entries that don't have id + addr (the two required fields).
// - Coerces other fields to strings so missing keys never cause runtime errors.
export function getSavedAddresses(
  profile: { saved_addresses?: string | null } | null | undefined,
): SavedAddress[] {
  if (!profile?.saved_addresses) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(profile.saved_addresses)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter(isAddressLike)
    .map((raw): SavedAddress => ({
      id:    String(raw.id),
      label: typeof raw.label === 'string' ? raw.label : '',
      name:  typeof raw.name  === 'string' ? raw.name  : '',
      addr:  typeof raw.addr  === 'string' ? raw.addr  : '',
      city:  typeof raw.city  === 'string' ? raw.city  : '',
      state: typeof raw.state === 'string' ? raw.state : '',
      pin:   typeof raw.pin   === 'string' ? raw.pin   : '',
    }))
}

export function formatPhone(raw: string): string {
  return raw.replace(/^\+91/, '')
}

export function formatCurrency(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN')
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

/**
 * Returns up to two uppercase initials from a name string.
 * "Rahul Sharma" → "RS", "Rahul" → "R", "" → "?"
 * Handles extra whitespace and single-word names safely.
 */
export function getInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Returns the best tracking URL for a given courier + tracking number.
 * Falls back to a Google Search URL when the courier is unknown.
 */
export function getCourierTrackingUrl(courier: string | null | undefined, trackingNumber: string): string {
  const key = (courier || '').toLowerCase().replace(/\s+/g, '')
  const template = COURIER_TRACKING_MAP[key]
  if (template) return template.replace('{number}', encodeURIComponent(trackingNumber))
  // Fallback: Google Search — better than nothing for unknown couriers
  return `https://www.google.com/search?q=${encodeURIComponent((courier || '') + ' tracking ' + trackingNumber)}`
}

export function getOrderStatusMessage(o: any): string {
  const ds = o._displayStatus || o.order_status || ''
  if (ds === 'delivered')           return '✅ Delivered! Enjoy your Himalayan goodness 🌿'
  if (ds === 'shipped' && o.shipped_at) {
    const est = new Date(o.shipped_at)
    est.setDate(est.getDate() + 5)
    return `🚚 Shipped · Est. delivery by ${est.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
  }
  if (ds === 'packed')              return '📦 Order packed, ready for dispatch'
  if (ds === 'processing')          return '⚙️ Processing your order'
  if (ds === 'confirmed')           return '✅ Order confirmed'
  if (ds === 'return_requested')    return '⏳ Return request under review · 24–48 hrs'
  if (ds === 'return_approved')     return '✅ Return approved — pickup being arranged'
  if (ds === 'refund_completed')    return '💚 Refund credited to your account!'
  if (ds === 'cancelled')           return '❌ Order cancelled'
  return ''
}

export type PaymentType = 'cod' | 'online' | 'unknown'

export function getPaymentLabel(method: string | undefined | null): { label: string; type: PaymentType } {
  if (!method || method.trim() === '') return { label: '', type: 'unknown' }
  const m = method.toLowerCase().trim()
  if (m === 'cod' || m === 'cash_on_delivery' || m === 'cash on delivery') {
    return { label: '💵 COD', type: 'cod' }
  }
  if (m === 'razorpay' || m === 'razorpay_online' || m === 'upi' || m === 'card' || m === 'online') {
    return { label: '💳 Online', type: 'online' }
  }
  return { label: '', type: 'unknown' }
}
