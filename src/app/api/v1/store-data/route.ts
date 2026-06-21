// ═══════════════════════════════════════════════════════════════
// /api/v1/store-data — public catalogue & settings endpoint
// Uses SERVICE KEY so RLS is bypassed — same as old pahadiroots.com
// Returns: products, product_images, product_variants, categories,
//          site_settings, states, state_images, team_members
//
// NOTE: Coupon data is intentionally NOT returned here — it would
// expose all active codes, values, and usage limits to any client.
// Use /api/v1/coupon-hints for safe, display-only coupon suggestions.
// ═══════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!

async function sbGet(table: string, query = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? '?' + query : ''}`
  const res = await fetch(url, {
    headers: {
      'apikey':        SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type':  'application/json',
    },
    // PERF/SEC FIX: no timeout was set — any of the 8 parallel Supabase fetches
    // could hang the serverless function until Vercel's 15-second hard limit.
    // 8 s matches the timeout used by every other Supabase fetch in the codebase
    // (sbAdmin in serverUtils.ts). next.revalidate is kept for edge caching.
    signal: AbortSignal.timeout(8_000),
    next: { revalidate: 60 }, // cache 60s at edge
  })
  if (!res.ok) throw new Error(`Supabase ${table}: ${res.status}`)
  return res.json()
}

export async function GET() {
  try {
    const [
      states,
      products,
      siteSettings,
      stateImages,
      productImages,
      productVariants,
      teamMembers,
      categories,
    ] = await Promise.all([
      sbGet('states',           'is_active=eq.true&order=name.asc').catch(() => []),
      sbGet('products',         'select=*&status=eq.active&is_deleted=eq.false&order=name.asc&limit=500').catch(() => []),
      sbGet('site_settings',    'select=key,value').catch(() => []),
      sbGet('state_images',     'select=state_id,image_url,sort_order&order=state_id.asc,sort_order.asc').catch(() => []),
      sbGet('product_images',   'select=product_id,image_url,sort_order&order=product_id.asc,sort_order.asc').catch(() => []),
      sbGet('product_variants',  'is_active=eq.true&order=product_id.asc,sort_order.asc').catch(() => []),
      sbGet('team_members',     'is_active=eq.true&order=sort_order.asc').catch(() => []),
      sbGet('categories',       'select=id,name,slug,emoji,description,image_url,sort_order&is_active=eq.true&order=sort_order.asc,name.asc').catch(() => []),
    ])

    // Convert site_settings array → object (same as old site)
    const settings: Record<string, string> = {}
    ;(siteSettings as { key: string; value: string }[]).forEach(s => { settings[s.key] = s.value })

    return NextResponse.json({
      states,
      products,
      settings,
      state_images:     stateImages,
      product_images:   productImages,
      product_variants: productVariants,
      team_members:     teamMembers,
      categories,
    }, {
      headers: {
        'Cache-Control': 's-maxage=60, stale-while-revalidate=120',
      },
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('store-data error:', message)
    // BUG FIX [ERROR HANDLING]: previously returned raw Supabase error text
    // (e.g. "Supabase products: 503") directly in the JSON response body — this
    // leaks internal infrastructure details (table names, HTTP status from the
    // upstream Supabase REST API) to any client that reads the error field.
    // In production return a generic message; in dev return the real one.
    const clientMessage = process.env.NODE_ENV === 'production'
      ? 'Failed to load store data — please try again'
      : message
    return NextResponse.json(
      { error: clientMessage, products: [], settings: {}, categories: [], product_images: [] },
      { status: 500 }
    )
  }
}
