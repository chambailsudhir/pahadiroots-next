import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { ok, fail } from '@/lib/api/serverUtils'

describe('shared API response helpers are never cacheable by a shared cache', () => {
  it('ok() answers private, no-store', () => { expect(ok({ a: 1 }).headers.get('cache-control')).toBe('private, no-store') })
  it('fail() answers private, no-store and keeps extra headers', () => {
    const r = fail(429, 'slow down', { 'Retry-After': '60' })
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(r.headers.get('retry-after')).toBe('60')
    expect(r.status).toBe(429)
  })
  it('a caller can still override the cache header explicitly', () => {
    expect(fail(400, 'x', { 'Cache-Control': 'public, max-age=60' }).headers.get('cache-control')).toBe('public, max-age=60')
  })
})

// VERIFY ROUND (L-6): the per-user routes below used to build some answers with a raw NextResponse.json(...) and no
// Cache-Control, which Next serves as `public, max-age=0, must-revalidate` — storable by a shared cache. Every
// NextResponse.json( call in these files must now carry PRIVATE_HEADERS (or an explicit Cache-Control); the ok()/fail()
// helpers already do. A static scan, so a new raw call cannot slip back in.
import fs from 'node:fs'
import path from 'node:path'

const PER_USER_ROUTES = [
  'app/api/auth/route.ts',
  'app/api/profile/route.ts',
  'app/api/wishlist/route.ts',
  'app/api/account/notifications/route.ts',
  'app/api/account/delete/route.ts',
  'app/api/orders/[id]/cancel/route.ts',
  'app/api/v1/referral/route.ts',
]

/** Every `NextResponse.json(` call expression in `src`, as its full balanced-parenthesis text. */
function responseCalls(src: string): string[] {
  const out: string[] = []
  const needle = 'NextResponse.json('
  let from = 0
  for (;;) {
    const at = src.indexOf(needle, from)
    if (at < 0) break
    let depth = 0, i = at + needle.length - 1
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')' && --depth === 0) break
    }
    out.push(src.slice(at, i + 1))
    from = i + 1
  }
  return out
}

describe('per-user API routes never answer without Cache-Control: private, no-store (L-6)', () => {
  it.each(PER_USER_ROUTES)('%s: every NextResponse.json( call sets PRIVATE_HEADERS or an explicit Cache-Control', (rel) => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8')
    const calls = responseCalls(src)          // may be empty: a route that only uses ok()/fail() is the goal
    const raw = calls.filter(c => !/PRIVATE_HEADERS|Cache-Control/.test(c))
    expect(raw, `raw NextResponse.json( calls without private headers in ${rel}:\n${raw.join('\n---\n')}`).toEqual([])
  })
  it('the scanner really finds a raw call (guards against a broken regex)', () => {
    expect(responseCalls('x; NextResponse.json({ a: f(1) }, { status: 409 }); y')).toEqual(['NextResponse.json({ a: f(1) }, { status: 409 })'])
    const total = PER_USER_ROUTES.reduce((n, rel) => n + responseCalls(fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8')).length, 0)
    expect(total).toBeGreaterThan(5)
  })
})

// Nov 2026 verification: the list above covered 7 files; orders, payments, coupons, auth/session, the invoice route and
// phone-verify still answered without the header. Now EVERY route under src/app/api that reads the customer's session
// (token, refresh, cookies) is found automatically, and every response it builds — NextResponse.json(, new NextResponse(,
// new Response(, NextResponse.redirect( — must carry PRIVATE_HEADERS / an explicit Cache-Control, or go through
// ok() / fail() / privateJson().
function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walkRoutes(p, out)
    else if (/^route\.(t|j)sx?$/.test(name)) out.push(p)
  }
  return out
}
function callsOf(src: string, needle: string): string[] {
  const out: string[] = []
  let from = 0
  for (;;) {
    const at = src.indexOf(needle, from)
    if (at < 0) break
    let depth = 0, i = at + needle.length - 1
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')' && --depth === 0) break
    }
    out.push(src.slice(at, i + 1))
    from = i + 1
  }
  return out
}
const READS_SESSION = /getToken\(|sbAuth\(|tryRefresh\(|cookies\(\)|req\.cookies|request\.cookies|pr_token/
const SESSION_ROUTES = walkRoutes(path.resolve(__dirname, '../app/api'))
  .filter(f => READS_SESSION.test(fs.readFileSync(f, 'utf8')))
  .map(f => path.relative(path.resolve(__dirname, '..'), f))

describe('every route that reads the session answers private, no-store (auto-discovered)', () => {
  it('finds the per-user routes (sanity: the known ones are in the scan)', () => {
    for (const r of ['app/api/auth/route.ts', 'app/api/v1/orders/route.ts', 'app/api/v1/payments/route.ts']) expect(SESSION_ROUTES).toContain(r)
  })
  it.each(SESSION_ROUTES)('%s', (rel) => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8')
    const raw = ['NextResponse.json(', 'new NextResponse(', 'new Response(', 'NextResponse.redirect(']
      .flatMap(n => callsOf(src, n))
      .filter(c => !/PRIVATE_HEADERS|PRIVATE_NO_STORE_HEADERS|Cache-Control|cache-control/.test(c))
    expect(raw, `responses without private, no-store in ${rel}:\n${raw.join('\n---\n')}`).toEqual([])
  })
})

describe('privateJson()', () => {
  it('always private, no-store; keeps status and extra headers; an explicit Cache-Control still wins', async () => {
    const { privateJson } = await import('@/lib/api/privateJson')
    const r = privateJson({ error: 'x' }, { status: 429, headers: { 'Retry-After': '60' } })
    expect(r.status).toBe(429)
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(r.headers.get('retry-after')).toBe('60')
    expect(privateJson({}, { headers: { 'Cache-Control': 'no-store' } }).headers.get('cache-control')).toBe('no-store')
  })
})
