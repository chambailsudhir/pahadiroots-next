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
//     // or: body: JSON.stringify({ all: true })      // revalidate the whole catalog
//     // or: body: JSON.stringify({ settings: true })  // Ann Bar/Ticker/Trust Bar/
//     //     Hero Stats/Store Status — called from pahadi-admin's settings page
//     //     (src/app/admin/settings/page.jsx) right after saveMany() succeeds,
//     //     via the admin repo's src/app/api/admin/route.js
//     //     'revalidate_storefront' action, which forwards here server-side.
//   })
//
// Required env var (add to Vercel project settings — pahadiroots-next):
//   REVALIDATE_SECRET=<any long random string, shared with pahadi-admin>
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { logger, captureError } from '@/lib/logger'
import { revalidatePath } from 'next/cache'
import { getStoreData } from '@/lib/storeData'
import { clearSiteSettingsCache } from '@/lib/getSiteSettings'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // ── Auth: Bearer token, matches the pattern used elsewhere in the API ──
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  const secret = process.env.REVALIDATE_SECRET

  if (!secret) {
    // Fail closed: if the env var isn't configured, refuse rather than
    // silently accepting an unauthenticated revalidation request.
    captureError(new Error('REVALIDATE_SECRET not configured'), { action: 'revalidate.no_secret', alert: true })
    return NextResponse.json({ error: 'Revalidation not configured' }, { status: 503 })
  }

  // BUG FIX 24a: JavaScript's !== short-circuits on the first differing character,
  // leaking timing information about the secret value (timing attack). An attacker
  // can enumerate the secret character-by-character by measuring response latency.
  // Fix: timingSafeEqual() from Node's crypto module runs in constant time regardless
  // of where the strings differ. Both buffers must be the same length; we compare
  // Buffer.from() representations so a length difference also yields a constant-time
  // false without short-circuiting.
  const tokenBuf  = Buffer.from(token  ?? '')
  const secretBuf = Buffer.from(secret ?? '')
  const isValid = tokenBuf.length === secretBuf.length && timingSafeEqual(tokenBuf, secretBuf)
  if (!isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { slug?: string; all?: boolean; settings?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { slug, all, settings } = body

  if (!slug && !all && !settings) {
    return NextResponse.json(
      { error: 'Provide { slug }, { all: true }, or { settings: true }' },
      { status: 400 }
    )
  }

  try {
    const revalidated: string[] = []

    if (slug || all) {
      // 1. Force the in-process storeData cache to refetch from Supabase
      //    on the very next call (clears the 60s CACHE_TTL window).
      await getStoreData(true)

      // 2. Invalidate Next's ISR cache so the next request rebuilds the page
      //    instead of serving the stale cached HTML.
      if (all) {
        revalidatePath('/products', 'page')
        revalidatePath('/products/[slug]', 'page')
        revalidated.push('/products', '/products/[slug] (all)')
      } else if (slug) {
        revalidatePath(`/products/${slug}`)
        revalidatePath('/products', 'page') // listing card (price/stock) also changed
        revalidated.push(`/products/${slug}`, '/products')
      }
    }

    // BUG FIX: site_settings (Ann Bar, Ticker, Trust Bar, Hero Stats Bar,
    // Store Status) had no on-demand invalidation at all — admin saves in
    // pahadi-admin's settings page never called this endpoint, so changes
    // only ever appeared once BOTH getSiteSettings()'s 5-min in-process
    // cache AND layout.tsx's 300s / page.tsx's 60s ISR windows happened to
    // expire (up to ~10 min worst case), directly contradicting the admin
    // panel's own "Changes go live instantly" copy. Clearing the in-process
    // cache + revalidating the root layout (Ann Bar / Ticker Bar live in
    // Header.tsx, rendered by layout.tsx) and the homepage (Hero Stats Bar /
    // Trust Bar live in page.tsx) + /maintenance (reads maintenance_message)
    // makes a settings save actually go live within seconds, matching what
    // the admin UI already promises.
    if (settings) {
      clearSiteSettingsCache()
      revalidatePath('/', 'layout')
      revalidatePath('/', 'page')
      revalidatePath('/maintenance', 'page')
      revalidated.push('/ (layout)', '/ (page)', '/maintenance')
    }

    return NextResponse.json({ success: true, revalidated })
  } catch (err) {
    logger.error('revalidate error', { action: 'revalidate.error', error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: 'Revalidation failed' }, { status: 500 })
  }
}
