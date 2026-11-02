/** Audit Nov 2026: id validation on PUT/PATCH, bounded optimistic guard, chunked bodies, explicit "full", normalised GET. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  sbAuth: vi.fn(), sbAdmin: vi.fn(), syncCustomerProfile: vi.fn(), getToken: vi.fn(), tryRefresh: vi.fn(), checkRateLimit: vi.fn(), checkCsrf: vi.fn(),
}))
vi.mock('@/lib/api/serverUtils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    ok:   (d: unknown) => NextResponse.json(d),
    fail: (status: number, msg: string) => NextResponse.json({ error: msg }, { status }),
    sbAuth: mocks.sbAuth, sbAdmin: mocks.sbAdmin, syncCustomerProfile: mocks.syncCustomerProfile, getToken: mocks.getToken,
    tryRefresh: mocks.tryRefresh, checkRateLimit: mocks.checkRateLimit, checkCsrf: mocks.checkCsrf, applyNewCookies: (r: NextResponse) => r,
  }
})

let stored: string | null = null
const mk = (method: string, body?: unknown, raw?: string) => new NextRequest('https://pahadiroots.com/api/wishlist', {
  method, headers: { 'Content-Type': 'application/json', origin: 'https://pahadiroots.com' },
  ...(method === 'GET' ? {} : { body: raw ?? JSON.stringify(body) }),
})
const route = () => import('@/app/api/wishlist/route')
const writes = () => mocks.sbAdmin.mock.calls.filter(([m]) => m === 'PATCH') as Array<[string, string, { wishlist_items: string }]>

beforeEach(() => {
  vi.clearAllMocks(); stored = JSON.stringify(['1'])
  mocks.checkCsrf.mockReturnValue(null); mocks.checkRateLimit.mockReturnValue(true)
  mocks.getToken.mockReturnValue('jwt'); mocks.tryRefresh.mockResolvedValue(null)
  mocks.sbAuth.mockResolvedValue({ id: 'u1' }); mocks.syncCustomerProfile.mockResolvedValue({ id: 58 })
  mocks.sbAdmin.mockImplementation(async (m: string) => (m === 'GET' ? [{ wishlist_items: stored }] : [{ id: 58 }]))
})

describe('id validation', () => {
  it('PUT keeps only numeric product ids', async () => {
    const { PUT } = await route()
    const res = await PUT(mk('PUT', { wishlist: ['5', 'abc', '<script>', 'x'.repeat(60), '1234567890123456', '7'] }))
    expect(res.status).toBe(200)
    expect(JSON.parse(writes()[0][2].wishlist_items)).toEqual(['5', '7'])
  })
  it('PATCH ignores non-numeric ids (400 when nothing valid remains)', async () => {
    const { PATCH } = await route()
    expect((await PATCH(mk('PATCH', { add: ['abc'] }))).status).toBe(400)
    expect((await PATCH(mk('PATCH', { add: ['abc', '4'] }))).status).toBe(200)
    expect(JSON.parse(writes()[0][2].wishlist_items)).toEqual(['1', '4'])
  })
})

describe('request body', () => {
  it('rejects an oversized body even without a Content-Length header (chunked)', async () => {
    const { PATCH } = await route()
    const big = JSON.stringify({ add: ['1'], pad: 'x'.repeat(70_000) })
    expect((await PATCH(mk('PATCH', undefined, big))).status).toBe(413)
  })
  it('400 on invalid JSON', async () => {
    const { PUT } = await route()
    expect((await PUT(mk('PUT', undefined, '{nope'))).status).toBe(400)
  })
})

describe('cap and guard', () => {
  it('returns 409 wishlist_full instead of silently dropping adds at the cap', async () => {
    stored = JSON.stringify(Array.from({ length: 200 }, (_, i) => String(i + 1)))
    const { PATCH } = await route()
    const res = await PATCH(mk('PATCH', { add: ['999'] }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('wishlist_full')
    expect(writes()).toHaveLength(0)
  })
  it('a removal still works on a full list, and an add that replaces a removal fits', async () => {
    stored = JSON.stringify(Array.from({ length: 200 }, (_, i) => String(i + 1)))
    const { PATCH } = await route()
    expect((await PATCH(mk('PATCH', { add: ['999'], remove: ['1'] }))).status).toBe(200)
  })
  it('keeps the guard URL bounded for an oversized legacy value (no permanently failing PATCH)', async () => {
    stored = JSON.stringify(Array.from({ length: 2000 }, (_, i) => String(100000000000 + i)))
    const { PATCH } = await route()
    const res = await PATCH(mk('PATCH', { add: ['3'], remove: ['100000000000'] }))
    expect(res.status).toBe(200)
    expect(writes()[0][1].length).toBeLessThan(500)
    expect(JSON.parse(writes()[0][2].wishlist_items).length).toBeLessThanOrEqual(200)
  })
})

describe('GET normalisation', () => {
  it('returns strings only: legacy numbers converted, junk dropped, deduped', async () => {
    stored = JSON.stringify([11, '28', '28', null, { a: 1 }, 'zzz', 1.5])
    const { GET } = await route()
    const res = await GET(mk('GET'))
    expect((await res.json()).wishlist).toEqual(['11', '28'])
  })
  it('non-array JSON → empty list', async () => {
    stored = '{"a":1}'
    const { GET } = await route()
    expect((await (await GET(mk('GET'))).json()).wishlist).toEqual([])
  })
})
