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
