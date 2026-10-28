// ─────────────────────────────────────────────────────────────────────────────
// lib/shippingCopy.ts  (client-safe)
//
// F-02 (Oct 2026 audit): three different free-shipping rules were live at once — the home
// page meta description ("above ₹799"), the announcement bar ("above ₹500") and the real admin
// setting `free_shipping_min` (0 → every order ships free). The ADMIN SETTING is the rule; this
// module is the only place that turns it into customer-facing words, and it rewrites any legacy
// hand-typed "free shipping above ₹N" sentence found in admin-authored copy so it can never
// disagree with the rule that checkout actually applies.
// ─────────────────────────────────────────────────────────────────────────────

import type { SiteSettings } from '@/types'
import { asNumber, FALLBACK_FREE_SHIPPING_MIN, FALLBACK_FLAT_SHIPPING } from '@/lib/siteSettingsHelpers'

export interface ShippingPolicy {
  /** Order value (after discounts) at/above which shipping is free. 0 → always free. */
  freeMin: number
  /** Flat charge below the threshold. */
  flat: number
  /** True when every order ships free (threshold 0, or no charge to levy). */
  freeForAll: boolean
}

export function getShippingPolicy(settings: Partial<SiteSettings> | Record<string, string | undefined>): ShippingPolicy {
  const s = settings as Record<string, string | undefined>
  const freeMin = Math.max(0, asNumber(s.free_shipping_min, FALLBACK_FREE_SHIPPING_MIN))
  const flat    = Math.max(0, asNumber(s.flat_shipping_charge, FALLBACK_FLAT_SHIPPING))
  return { freeMin, flat, freeForAll: freeMin <= 0 || flat <= 0 }
}

function inr(n: number): string {
  return `₹${Number.isInteger(n) ? n.toLocaleString('en-IN') : n.toFixed(2)}`
}

/** "Free shipping on all orders" | "Free shipping on orders above ₹N" */
export function freeShippingPhrase(settings: Partial<SiteSettings> | Record<string, string | undefined>): string {
  const p = getShippingPolicy(settings)
  return p.freeForAll ? 'Free shipping on all orders' : `Free shipping on orders above ${inr(p.freeMin)}`
}

/** Short sub-line for badges: "On all orders" | "On orders above ₹N" */
export function freeShippingSub(settings: Partial<SiteSettings> | Record<string, string | undefined>): string {
  const p = getShippingPolicy(settings)
  return p.freeForAll ? 'On all orders' : `On orders above ${inr(p.freeMin)}`
}

/** Sentence for the shipping policy page. */
export function shippingPolicySentence(settings: Partial<SiteSettings> | Record<string, string | undefined>): string {
  const p = getShippingPolicy(settings)
  return p.freeForAll
    ? 'Free shipping on all orders · Pan-India delivery'
    : `Free shipping on orders above ${inr(p.freeMin)} · Flat ${inr(p.flat)} on orders below ${inr(p.freeMin)} · Pan-India delivery`
}

// Matches a hand-typed free-shipping claim WITH an amount, e.g.
//   "Free shipping above ₹799"         "free delivery on orders over Rs. 500"
//   "Free shipping · On orders above ₹500"       "FREE SHIPPING ABOVE INR 999"
// The gap between "shipping" and the comparator is limited to separators/short filler (no digits,
// no sentence break) so unrelated sentences are never swallowed.
const CLAIM_RE = new RegExp(
  '(free\\s+(?:shipping|delivery))' +                       // 1: the claim
  '[\\s·|•:,\\-–—]*' +                                      // separators
  '(?:on\\s+|for\\s+)?(?:all\\s+)?(?:orders?\\s+)?' +       // optional "on (all) orders"
  '(?:above|over|of|from|min(?:imum)?(?:\\s+order)?(?:\\s+of)?|≥|>=)\\s*' +
  '(?:₹|rs\\.?|inr)\\s*\\d[\\d,]*(?:\\.\\d+)?\\+?',
  'gi',
)

// "Free shipping on all orders" typed by hand is ALSO a claim about the rule: it becomes false the
// day free_shipping_min is raised above 0. Rewritten to the live rule too, so admin text such as the
// SEO meta description always follows the setting (and is unchanged while the rule is "all orders").
const ALL_ORDERS_RE = /(free\s+(?:shipping|delivery))\s+on\s+all\s+orders/gi

/**
 * Rewrites any "free shipping above ₹N" claim in admin-authored copy to the live rule, and expands
 * the {{free_shipping_min}} / {{free_shipping}} tokens. Text with no claim is returned unchanged.
 */
export function reconcileShippingCopy(text: string, settings: Partial<SiteSettings> | Record<string, string | undefined>): string {
  if (!text || typeof text !== 'string') return text
  const p = getShippingPolicy(settings)
  let out = text
  if (out.includes('{{')) {
    out = out
      .replace(/\{\{\s*free_shipping_min\s*\}\}/gi, inr(p.freeMin))
      .replace(/\{\{\s*flat_shipping_charge\s*\}\}/gi, inr(p.flat))
      .replace(/\{\{\s*free_shipping\s*\}\}/gi, freeShippingPhrase(settings))
  }
  const restyle = (_m: string, claim: string) => {
    // Preserve the author's casing: "FREE SHIPPING…", "Free shipping…" or mid-sentence "free shipping…".
    const phrase = freeShippingPhrase(settings)
    if (claim === claim.toUpperCase()) return phrase.toUpperCase()
    if (claim[0] === claim[0].toLowerCase()) return phrase[0].toLowerCase() + phrase.slice(1)
    return phrase
  }
  out = out.replace(CLAIM_RE, restyle)
  out = out.replace(ALL_ORDERS_RE, restyle)
  return out
}

/**
 * Delivery timing exactly as published on the Shipping Policy page (app/policies/[type]/page.tsx:
 * "Dispatch to courier: within 2 business days", "Metro cities: 3–5 business days after dispatch",
 * "Non-metro / remote areas: 7–12 business days after dispatch"). PDP audit P1-6: the PDP, the PIN checker and
 * the policy used to disagree ("1–2" vs "2", "days" vs "business days after dispatch", per-zone 2–4/4–6/5–8).
 * __tests__/shippingTiming.test.ts fails if the policy page and these strings drift apart.
 */
export const SHIPPING_TIMING = {
  dispatch: '2 business days',
  metro:    '3–5 business days',
  remote:   '7–12 business days',
} as const

/** "Metro cities 3–5 business days · Non-metro / remote 7–12 business days after dispatch" */
export const DELIVERY_WINDOWS_TEXT =
  `Metro cities ${SHIPPING_TIMING.metro} · Non-metro / remote ${SHIPPING_TIMING.remote} after dispatch (dispatched within ${SHIPPING_TIMING.dispatch})`

// ── AUDIT S3-001 / S3-004 / G2 A15: ONE source for every delivery / returns / notification sentence ──
// The cart, checkout, contact FAQ, account pages, order-success and policy pages each carried their own
// hand-typed promise ("3–5 Days", "today's dispatch", "WhatsApp updates", "24–48 hrs") that contradicted
// the Shipping / Returns policy. Every customer-facing surface now quotes these constants; the
// shippingTiming test fails if a surface re-introduces a hard-coded window.

/** Short badge title + sub-line (cart / checkout trust rows). */
export const DELIVERY_BADGE = {
  title: 'Pan-India Delivery',
  sub:   `Metro ${SHIPPING_TIMING.metro} · remote ${SHIPPING_TIMING.remote} after dispatch`,
} as const

/** Returns / damage-claim windows exactly as the Returns Policy page states them. */
export const RETURNS_TIMING = {
  claimWindow:   '48 hours',
  reviewWindow:  '24–48 hours',
  refundWindow:  '7–10 business days',
} as const

export const RETURNS_BADGE = {
  title: `${RETURNS_TIMING.claimWindow} Claims`,
  sub:   'Damaged / defective items, with photo or video',
} as const

/** FAQ answers (contact page) — derived, never hand-typed. */
export const DELIVERY_FAQ_ANSWER =
  `Orders are dispatched within ${SHIPPING_TIMING.dispatch}. Delivery takes ${SHIPPING_TIMING.metro} after dispatch to metro cities and ${SHIPPING_TIMING.remote} to non-metro / remote areas. See our Shipping Policy for details.`

export const DAMAGE_FAQ_ANSWER =
  `Email or WhatsApp us a photo or short video within ${RETURNS_TIMING.claimWindow} of delivery with your order number. Our team reviews claims within ${RETURNS_TIMING.reviewWindow}; approved claims get a replacement or refund (refunds within ${RETURNS_TIMING.refundWindow} after approval) as set out in our Return & Refund Policy.`

/** Email is the only notification channel the system actually sends on (no WhatsApp/SMS sender exists). */
export const TRACKING_NOTIFICATION_TEXT =
  'Tracking details are emailed to you once your order ships. You can also check My Account → Orders.'

export const TRACK_FAQ_ANSWER =
  `Visit our Track Order page and enter your order number and phone number. ${TRACKING_NOTIFICATION_TEXT}`

/** Account order status line after dispatch — no calendar-day guess. */
export const SHIPPED_STATUS_TEXT =
  `Shipped · delivery in ${SHIPPING_TIMING.metro} (metro) or ${SHIPPING_TIMING.remote} (remote) after dispatch`

export const RETURN_REVIEW_STATUS_TEXT = `Return request under review · ${RETURNS_TIMING.reviewWindow}`
