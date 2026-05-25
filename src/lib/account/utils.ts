// ─────────────────────────────────────────────────────────────
// Shared utility functions for account module
// ─────────────────────────────────────────────────────────────

import { COURIER_TRACKING_MAP } from './constants'

export function getSavedAddresses(profile: any): any[] {
  try { return JSON.parse(profile?.saved_addresses || '[]') } catch { return [] }
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
