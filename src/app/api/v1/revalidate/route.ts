// ─────────────────────────────────────────────────────────────────────────────
// app/api/v1/revalidate/route.ts
//
// BUG FIX (infra): getStoreData() in lib/storeData.ts caches the full catalog
// in-process for 60s (CACHE_TTL), and the PDP itself has `revalidate = 3600`
// (1 hour ISR). Combined, an admin price/stock edit in pahadi-admin could take
// up to an hour to actually appear on a live product page — with no manual
// way to force it sooner short of a full redeploy.
//
// Fix: a secret-protected endpoint that:
//   1. Clears the in-process storeData cache immediately (forces next
//      getStoreData() call to hit Supabase fresh)
//   2. Calls Next's revalidatePath() to invalidate the ISR cache for the
//      specific product page (or /products listing, or both)
//
// Call this from pahadi-admin right after any product/price/stock/variant
// write succeeds:
//
//   await fetch('https://pahadiroots.com/api/v1/revalidate', {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'application/json',
//       Authorization: `Bearer ${process.env.REVALIDATE_SECRET}`,
//     },
//     body: JSON.stringify({ slug: 'himalayan-wild-honey' }),
//     // or: body: JSON.stringify({ all: true })  // revalidate the whole catalog
//   })
//
// Required env var (add to Vercel project settings — pahadiroots-next):
//   REVALIDATE_SECRET=<any long random string, shared with pahadi-admin>
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getStoreData } from '@/lib/storeData'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // ── Auth: Bearer token, matches the pattern used elsewhere in the API ──
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  const secret = process.env.REVALIDATE_SECRET

  if (!secret) {
    // Fail closed: if the env var isn't configured, refuse rather than
    // silently accepting an unauthenticated revalidation request.
    console.error('[revalidate] REVALIDATE_SECRET is not set')
    return NextResponse.json({ error: 'Revalidation not configured' }, { status: 503 })
  }

  if (token !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { slug?: string; all?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { slug, all } = body

  if (!slug && !all) {
    return NextResponse.json(
      { error: 'Provide either { slug } for a single product or { all: true } for the full catalog' },
      { status: 400 }
    )
  }

  try {
    // 1. Force the in-process storeData cache to refetch from Supabase
    //    on the very next call (clears the 60s CACHE_TTL window).
    await getStoreData(true)

    // 2. Invalidate Next's ISR cache so the next request rebuilds the page
    //    instead of serving the stale cached HTML.
    const revalidated: string[] = []

    if (all) {
      revalidatePath('/products', 'page')
      revalidatePath('/products/[slug]', 'page')
      revalidated.push('/products', '/products/[slug] (all)')
    } else if (slug) {
      revalidatePath(`/products/${slug}`)
      revalidatePath('/products', 'page') // listing card (price/stock) also changed
      revalidated.push(`/products/${slug}`, '/products')
    }

    return NextResponse.json({ success: true, revalidated })
  } catch (err) {
    console.error('[revalidate] error:', err)
    return NextResponse.json({ error: 'Revalidation failed' }, { status: 500 })
  }
}
