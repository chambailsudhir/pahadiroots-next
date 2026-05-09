import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// In-memory rate limit store (Vercel Edge — resets per instance)
// For production use, swap this with Upstash Redis
const rateLimitMap = new Map<string, { count: number; ts: number }>()
const RATE_WINDOW  = 60 * 1000   // 1 minute
const RATE_LIMIT   = 60          // 60 requests/minute per IP (general)
const API_LIMIT    = 20          // 20 API requests/minute per IP

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ─── Rate limiting on API routes ─────────────────────────────────────────

  if (pathname.startsWith('/api/v1/')) {
    const ip = req.ip || req.headers.get('x-forwarded-for') || 'unknown'
    const key = `api:${ip}`
    const now = Date.now()
    const entry = rateLimitMap.get(key)

    if (entry && now - entry.ts < RATE_WINDOW) {
      if (entry.count >= API_LIMIT) {
        return NextResponse.json(
          { error: 'Too many requests. Please slow down.' },
          { status: 429 }
        )
      }
      entry.count++
    } else {
      rateLimitMap.set(key, { count: 1, ts: now })
    }

    return NextResponse.next()
  }

  // ─── Store open/closed check ──────────────────────────────────────────────
  // Skip for: API routes, _next static, favicon, maintenance page itself

  const skip =
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/maintenance') ||
    pathname.startsWith('/auth/') ||   // ← auth callbacks must never be intercepted
    pathname === '/favicon.ico' ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.svg')

  if (skip) return NextResponse.next()

  try {
    // Fetch store_open setting
    const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (supabaseUrl && supabaseAnon) {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/site_settings?key=eq.store_open&select=value`,
        {
          headers: {
            apikey:        supabaseAnon,
            Authorization: `Bearer ${supabaseAnon}`,
          },
          // Short timeout — don't block page load
          signal: AbortSignal.timeout(2000),
        }
      )

      if (res.ok) {
        const data = await res.json()
        const storeOpen = data?.[0]?.value !== 'false'

        if (!storeOpen) {
          return NextResponse.rewrite(new URL('/maintenance', req.url))
        }
      }
    }
  } catch {
    // If check fails, allow through (fail open — better than blocking real customers)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Apply to all routes except static files
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
