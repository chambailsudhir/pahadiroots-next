/**
 * /api/v1/cart-settings — returns only the site_settings keys the cart page needs.
 *
 * SRP fix: store-data was responsible for settings + upsells + reviews + products
 * + variants + images + states + categories all in one response. This endpoint
 * owns only the cart-relevant settings slice — a ~15 key fetch instead of the
 * full table scan, cached at the edge for 60 s.
 *
 * Consumed by: useCartPage hook (replaces the settings portion of store-data)
 */

import { NextResponse } from 'next/server'

// Use anon key for this read-only GET endpoint — the service key grants full DB
// write access and should be reserved for mutations and admin operations.
// Ensure the `site_settings` table RLS policy allows anon SELECT on key+value.
const SUPABASE_KEY  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/** Keys the cart page actually reads — nothing more is returned to the client. */
const CART_SETTING_KEYS = [
  'free_shipping_min',
  'flat_shipping_charge',
  'min_order_amount',
  'whatsapp_number',
  'prepaid_discount_pct',
  'cod_enabled',
  'cod_max_value',
  // BUG FIX: upi_enabled and loyalty_enabled were missing but are consumed by
  // CheckoutClient.tsx — their absence caused UPI/loyalty features to silently
  // fall back to disabled state on the checkout page.
  'upi_enabled',
  'loyalty_enabled',
  'loyalty_points_per_rupee',
  // BUG FIX: the four keys below were absent from CART_SETTING_KEYS even though
  // OrderSummary reads all of them from the settings prop. Their absence caused
  // the loyalty panel to always use hardcoded defaults (0.25 ₹/coin, 20% cap,
  // 40-coin minimum, "Pahadi Coins" label) instead of the admin-configured values,
  // silently overriding any customisation made in the CMS.
  'loyalty_points_value',
  'loyalty_points_label',
  'loyalty_min_redeem',
  'loyalty_max_redeem_pct',
  'review_1_name',     'review_1_location',     'review_1_text',
  'review_2_name',     'review_2_location',     'review_2_text',
  'review_3_name',     'review_3_location',     'review_3_text',
] as const

export type CartSettingKey = (typeof CART_SETTING_KEYS)[number]

// BUG FIX: the filter string and URL were rebuilt on every request even though
// CART_SETTING_KEYS is a static module-level constant. Hoisting to module level
// means the string concatenation runs once on cold-start, not per request.
const _CART_SETTINGS_FILTER = CART_SETTING_KEYS.map(k => `key.eq.${k}`).join(',')
const _CART_SETTINGS_URL    = `${process.env.NEXT_PUBLIC_SUPABASE_URL!}/rest/v1/site_settings?or=(${_CART_SETTINGS_FILTER})&select=key,value`

async function fetchCartSettings(): Promise<Record<string, string>> {
  // Use the module-level pre-built URL (hoisted from per-request rebuild)
  const res = await fetch(_CART_SETTINGS_URL, {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    // SEC/PERF FIX: without a timeout, a slow or unresponsive Supabase response
    // hangs this serverless function until Vercel's hard 15-second limit fires,
    // blocking the entire cart page render. 4 s is generous for a simple indexed
    // SELECT on ~15 rows.
    signal: AbortSignal.timeout(4_000),
    next: { revalidate: 60 },
  })

  if (!res.ok) throw new Error(`site_settings fetch failed: ${res.status}`)

  const rows: { key: string; value: string }[] = await res.json()
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}

export async function GET() {
  try {
    const settings = await fetchCartSettings()
    return NextResponse.json(
      { settings },
      { headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=120' } },
    )
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('[cart-settings]', message)
    // Return empty settings so the cart renders with safe defaults
    return NextResponse.json({ settings: {} }, { status: 500 })
  }
}
