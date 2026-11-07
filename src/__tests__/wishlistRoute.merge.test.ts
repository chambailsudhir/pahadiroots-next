/**
 * ACC-052 — live finding: opening the home page on a device with an empty local wishlist sent PUT {wishlist: []} and
 * replaced the customer's saved wishlist ([11,28]) with nothing. PATCH merges deltas into the STORED list; PUT can no
 * longer replace a non-empty list with an empty one.
 */
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
    tryRefresh: mocks.tryRefresh, checkRateLimit: mocks.checkRateLimit, checkRateLimitShared: async (...a: [string, number?, number?]) => mocks.checkRateLimit(...a), checkCsrf: mocks.checkCsrf, applyNewCookies: (r: NextResponse) => r,
  }
})

let stored: string | null = JSON.stringify(['1', '2'])
let writeResult: unknown[] = [{ id: 58 }]
const req = (method: 'PATCH' | 'PUT', body: unknown, headers: Record<string, string> = {}) => import('@/app/api/wishlist/route').then(m =>
  (method === 'PATCH' ? m.PATCH : m.PUT)(new NextRequest('https://pahadiroots.com/api/wishlist', {
    method, headers: { 'Content-Type': 'application/json', origin: 'https://pahadiroots.com', 'x-forwarded-for': '7.7.7.7', ...headers }, body: JSON.stringify(body),
  })))
const writes = () => mocks.sbAdmin.mock.calls.filter(([m]) => m === 'PATCH') as Array<[string, string, { wishlist_items: string }]>

beforeEach(() => {
  vi.clearAllMocks(); stored = JSON.stringify(['1', '2']); writeResult = [{ id: 58 }]
  mocks.checkCsrf.mockReturnValue(null); mocks.checkRateLimit.mockReturnValue(true)
  mocks.getToken.mockReturnValue('jwt'); mocks.tryRefresh.mockResolvedValue(null)
  mocks.sbAuth.mockResolvedValue({ id: 'u1' }); mocks.syncCustomerProfile.mockResolvedValue({ id: 58 })
  mocks.sbAdmin.mockImplementation(async (m: string) => (m === 'GET' ? [{ wishlist_items: stored }] : writeResult))
})

describe('PATCH /api/wishlist — merges a change into the stored list', () => {
  it('adds and removes only what was named; everything else the customer saved is untouched', async () => {
    const res = await req('PATCH', { add: ['3'], remove: ['1'] })
    expect(res.status).toBe(200)
    expect(JSON.parse(writes()[0][2].wishlist_items)).toEqual(['2', '3'])
    expect((await res.json()).wishlist).toEqual(['2', '3'])
  })

  it('a write is conditional on the list not having changed since it was read (no lost updates)', async () => {
    await req('PATCH', { add: ['3'] })
    expect(writes()[0][1]).toContain(`wishlist_items=eq.${encodeURIComponent(stored!)}`)
  })

  it('works for a customer who has never used the wishlist (stored value NULL)', async () => {
    stored = null
    const res = await req('PATCH', { add: ['9'] })
    expect(res.status).toBe(200)
    expect(writes()[0][1]).toContain('wishlist_items=is.null')
    expect(JSON.parse(writes()[0][2].wishlist_items)).toEqual(['9'])
  })

  it('writes nothing when the change is already reflected', async () => {
    const res = await req('PATCH', { add: ['2'], remove: ['99'] })
    expect(res.status).toBe(200)
    expect(writes()).toHaveLength(0)
  })

  it('409 (not a silent overwrite) when the list keeps changing underneath it', async () => {
    writeResult = []                                        // the conditional write never matches
    expect((await req('PATCH', { add: ['3'] })).status).toBe(409)
    expect(writes()).toHaveLength(3)                        // retried, then gave up
  })

  it.each([[{}], [{ add: [], remove: [] }], [{ add: 'x' }], [{ add: [5, null] }]])('400s for an empty or malformed change %j', async (body) => {
    expect((await req('PATCH', body)).status).toBe(400)
    expect(writes()).toHaveLength(0)
  })

  it('401s when logged out', async () => {
    mocks.getToken.mockReturnValue(null)
    expect((await req('PATCH', { add: ['3'] })).status).toBe(401)
  })
})

describe('PUT /api/wishlist — can no longer erase a saved list (legacy clients)', () => {
  it('IGNORES an empty list when the account has saved items — the exact live data-loss scenario', async () => {
    const res = await req('PUT', { wishlist: [] })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ignored).toBe('empty_list_would_erase_saved_items')
    expect(body.count).toBe(2)
    expect(writes()).toHaveLength(0)
  })

  it('still clears when explicitly asked to (x-wishlist-clear: 1)', async () => {
    await req('PUT', { wishlist: [] }, { 'x-wishlist-clear': '1' })
    expect(JSON.parse(writes()[0][2].wishlist_items)).toEqual([])
  })

  it('an empty PUT for an account that is already empty is a normal no-op write', async () => {
    stored = null
    expect((await req('PUT', { wishlist: [] })).status).toBe(200)
  })

  it('a non-empty PUT still replaces the list (unchanged legacy behaviour)', async () => {
    await req('PUT', { wishlist: ['7'] })
    expect(JSON.parse(writes()[0][2].wishlist_items)).toEqual(['7'])
  })
})
