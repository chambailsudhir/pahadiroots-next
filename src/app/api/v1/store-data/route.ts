// ═══════════════════════════════════════════════════════════════
// /api/v1/store-data — mirrors old site's api/store-data.js exactly
// Uses SERVICE KEY so RLS is bypassed — same as old pahadiroots.com
// Returns: products, product_images, product_variants, categories,
//          site_settings, states, state_images, coupons, team_members
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
      coupons,
      stateImages,
      productImages,
      productVariants,
      teamMembers,
      categories,
    ] = await Promise.all([
      sbGet('states',           'is_active=eq.true&order=name.asc').catch(() => []),
      sbGet('products',         'select=*&status=eq.active&is_deleted=eq.false&order=name.asc&limit=500').catch(() => []),
      sbGet('site_settings',    'select=key,value').catch(() => []),
      sbGet('coupons',          'is_active=eq.true&select=code,type,value,min_order,max_uses,uses_count,expires_at,first_order_only,max_discount').catch(() => []),
      sbGet('state_images',     'select=state_id,image_url,sort_order&order=state_id.asc,sort_order.asc').catch(() => []),
      sbGet('product_images',   'select=product_id,image_url,sort_order&order=product_id.asc,sort_order.asc').catch(() => []),
      sbGet('product_variants',  'is_active=eq.true&order=product_id.asc,sort_order.asc').catch(() => []),
      sbGet('team_members',     'is_active=eq.true&order=sort_order.asc').catch(() => []),
      sbGet('categories',       'select=id,name,slug,emoji,description,image_url,sort_order&is_active=eq.true&order=sort_order.asc,name.asc').catch(() => []),
    ])

    // Convert site_settings array → object (same as old site)
    const settings: Record<string, string> = {}
    ;(siteSettings as any[]).forEach((s: any) => { settings[s.key] = s.value })

    return NextResponse.json({
      states,
      products,
      settings,
      coupons,
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
  } catch (e: any) {
    console.error('store-data error:', e.message)
    return NextResponse.json(
      { error: e.message, products: [], settings: {}, categories: [], product_images: [] },
      { status: 500 }
    )
  }
}
