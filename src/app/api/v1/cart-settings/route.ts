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

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
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
  'review_1_name',     'review_1_location',     'review_1_text',
  'review_2_name',     'review_2_location',     'review_2_text',
  'review_3_name',     'review_3_location',     'review_3_text',
] as const

export type CartSettingKey = (typeof CART_SETTING_KEYS)[number]

async function fetchCartSettings(): Promise<Record<string, string>> {
  // Build an `or` filter so Supabase returns only the keys we care about.
  const filter = CART_SETTING_KEYS.map(k => `key.eq.${k}`).join(',')
  const url    = `${SUPABASE_URL}/rest/v1/site_settings?or=(${filter})&select=key,value`

  const res = await fetch(url, {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
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
