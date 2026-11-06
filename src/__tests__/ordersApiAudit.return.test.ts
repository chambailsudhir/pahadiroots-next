/**
 * Nov 2026 orders-API audit (F): return route vs DB index/trigger semantics, quantity rules, window,
 * upload-url gating, orders list status allow-list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ACTIVE_STATUSES, ORDER_STATUS_VALUES } from '@/lib/account/constants'

const mocks = vi.hoisted(() => ({
  sbAdmin: vi.fn(), sbAdminCount: vi.fn(), sbAuth: vi.fn(), getToken: vi.fn(), tryRefresh: vi.fn(),
  syncCustomerProfile: vi.fn(), applyNewCookies: vi.fn(), checkCsrf: vi.fn(), verifyEvidencePaths: vi.fn(),
  checkRateLimitKv: vi.fn(),
}))
vi.mock('@/lib/api/serverUtils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    ok: (d: unknown) => NextResponse.json(d),
    fail: (status: number, msg: string) => NextResponse.json({ error: msg }, { status }),
    sbAdmin: mocks.sbAdmin, sbAdminCount: mocks.sbAdminCount, sbAuth: mocks.sbAuth, getToken: mocks.getToken,
    tryRefresh: mocks.tryRefresh, syncCustomerProfile: mocks.syncCustomerProfile, applyNewCookies: mocks.applyNewCookies,
    checkCsrf: mocks.checkCsrf,
  }
})
vi.mock('@/lib/server/returnEvidence', () => ({ verifyEvidencePaths: mocks.verifyEvidencePaths }))
vi.mock('@/lib/api/rateLimitKv', () => ({ checkRateLimitKv: mocks.checkRateLimitKv }))

const ORDER = { id: 501, order_status: 'delivered', delivered_at: new Date().toISOString(), updated_at: new Date().toISOString(), order_number: 'PR-501' }
const ITEMS = [{ id: 1, variant_id: 11, product_id: 7, quantity: 2 }, { id: 2, variant_id: 12, product_id: 8, quantity: 1 }]

let order: Record<string, unknown> = ORDER
let returnsRows: unknown[] = []
let insertError: unknown = null
const inserts = () => mocks.sbAdmin.mock.calls.filter(c => c[0] === 'POST' && String(c[1]).includes('/rest/v1/returns'))

const post = async (body: object) => {
  const { POST } = await import('@/app/api/orders/[id]/return/route')
  return POST(new NextRequest('https://pahadiroots.com/api/orders/501/return', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://pahadiroots.com' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: '501' }) })
}

function wireDefault() {
  mocks.sbAdmin.mockImplementation(async (m: string, path: string) => {
    if (m === 'GET' && path.includes('/rest/v1/orders?')) return [order]
    if (m === 'GET' && path.includes('/rest/v1/order_items?')) return ITEMS
    if (m === 'GET' && path.includes('/rest/v1/returns?')) return returnsRows
    if (m === 'POST' && path.includes('/rest/v1/returns')) { if (insertError) throw insertError; return null }
    if (m === 'GET' && path.includes('/rest/v1/site_settings')) return [{ value: 'true' }]
    throw new Error(`unexpected ${m} ${path}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  order = ORDER; returnsRows = []; insertError = null
  mocks.checkCsrf.mockReturnValue(null); mocks.getToken.mockReturnValue('t'); mocks.tryRefresh.mockResolvedValue(null)
  mocks.sbAuth.mockResolvedValue({ id: 'u' }); mocks.syncCustomerProfile.mockResolvedValue({ id: 'c1' })
  mocks.verifyEvidencePaths.mockResolvedValue([]); mocks.checkRateLimitKv.mockResolvedValue(true)
  wireDefault()
})

describe('return route — DB index/trigger alignment', () => {
  it("a 'replaced' return no longer blocks — the customer holds a new unit and may return it (db_migration_v24)", async () => {
    returnsRows = [{ id: 1, status: 'replaced', variant_id: 11, replacement_shipped_at: null }]
    const res = await post({ reason: 'damaged', variant_id: 11, product_id: 7 })
    expect(res.status).toBe(200)
    expect(inserts()).toHaveLength(1)
  })

  it('refunded / rejected / replaced are the terminal statuses (they mirror the unique index)', async () => {
    returnsRows = [{ id: 1, status: 'refunded', variant_id: 11 }, { id: 2, status: 'rejected', variant_id: 11 }, { id: 3, status: 'replaced', variant_id: 11 }]
    expect((await post({ reason: 'damaged', variant_id: 11, product_id: 7 })).status).toBe(200)
  })

  it('a damaged REPLACEMENT is returnable even though the original delivery was long ago — the window restarts from the replacement', async () => {
    const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()
    order = { ...ORDER, delivered_at: daysAgo(20) }                       // original delivery: window closed 18 days ago
    returnsRows = [{ id: 1, status: 'replaced', variant_id: 11, replacement_shipped_at: daysAgo(4) }]   // shipped 4 d ago + 3 d transit = arrived ~1 d ago
    expect((await post({ reason: 'damaged', variant_id: 11, product_id: 7 })).status).toBe(200)
  })

  it('…but not for ever: the replacement has its own 48 h window', async () => {
    const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()
    order = { ...ORDER, delivered_at: daysAgo(30) }
    returnsRows = [{ id: 1, status: 'replaced', variant_id: 11, replacement_shipped_at: daysAgo(12) }]
    const res = await post({ reason: 'damaged', variant_id: 11, product_id: 7 })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/replacement/i)
    expect(inserts()).toHaveLength(0)
  })

  it('a replacement of a DIFFERENT item does not re-open the window for this one', async () => {
    const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()
    order = { ...ORDER, delivered_at: daysAgo(20) }
    returnsRows = [{ id: 1, status: 'replaced', variant_id: 12, replacement_shipped_at: daysAgo(4) }]
    expect((await post({ reason: 'damaged', variant_id: 11, product_id: 7 })).status).toBe(422)
  })

  it('maps a 23505 unique violation (double click race) to 409, not 500', async () => {
    insertError = { status: 409, message: JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint "ux_returns_active_order_item"' }) }
    expect((await post({ reason: 'damaged' })).status).toBe(409)
  })

  it('maps guard_return_item check_violation (23514) to a 422 with a clear message', async () => {
    insertError = { status: 400, message: JSON.stringify({ code: '23514', message: 'Return quantity 2 is more than can still be returned' }) }
    const res = await post({ reason: 'damaged', variant_id: 11, product_id: 7 })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/already been returned/i)
  })

  it('still 500s for an unrelated DB failure', async () => {
    insertError = { status: 500, message: 'boom' }
    expect((await post({ reason: 'damaged' })).status).toBe(500)
  })

  it('blocks a whole-order return while an item return is open, and the reverse', async () => {
    returnsRows = [{ id: 1, status: 'requested', variant_id: 11 }]
    expect((await post({ reason: 'damaged' })).status).toBe(409)
    returnsRows = [{ id: 2, status: 'approved', variant_id: null }]
    expect((await post({ reason: 'damaged', variant_id: 12, product_id: 8 })).status).toBe(409)
  })

  it('allows a return on a different item', async () => {
    returnsRows = [{ id: 1, status: 'requested', variant_id: 11 }]
    expect((await post({ reason: 'damaged', variant_id: 12, product_id: 8 })).status).toBe(200)
  })
})

describe('return route — quantity rules', () => {
  it('whole-order return ignores a client quantity (stored as 1)', async () => {
    expect((await post({ reason: 'damaged', quantity: 1000000 })).status).toBe(200)
    expect(inserts()[0][2]).toMatchObject({ quantity: 1, variant_id: null })
  })
  it('item return is clamped to the ordered quantity', async () => {
    await post({ reason: 'damaged', variant_id: 11, product_id: 7, quantity: 99 })
    expect(inserts()[0][2]).toMatchObject({ quantity: 2, variant_id: 11 })
  })
  it('0.5 floors to 0 and is rejected (400) instead of stored as 0', async () => {
    const res = await post({ reason: 'damaged', variant_id: 11, product_id: 7, quantity: 0.5 })
    expect(res.status).toBe(400)
    expect(inserts()).toHaveLength(0)
  })
  it('keeps a valid fractional quantity floored (1.9 -> 1)', async () => {
    await post({ reason: 'damaged', variant_id: 11, product_id: 7, quantity: 1.9 })
    expect(inserts()[0][2]).toMatchObject({ quantity: 1 })
  })
})

describe('return route — window and ordering', () => {
  it('requires delivered_at: updated_at no longer extends the window', async () => {
    order = { ...ORDER, delivered_at: null, updated_at: new Date().toISOString() }
    expect((await post({ reason: 'damaged' })).status).toBe(422)
    expect(inserts()).toHaveLength(0)
  })
  it('does not sign photos (outbound calls) for a non-delivered order or a closed window', async () => {
    const paths = ['returns/501/1-a.jpg']
    order = { ...ORDER, order_status: 'shipped' }
    expect((await post({ reason: 'damaged', photo_paths: paths })).status).toBe(422)
    order = { ...ORDER, delivered_at: new Date(Date.now() - 10 * 86_400_000).toISOString() }
    expect((await post({ reason: 'damaged', photo_paths: paths })).status).toBe(422)
    expect(mocks.verifyEvidencePaths).not.toHaveBeenCalled()
  })
  it('verifies photos for a valid return and stores the bare object PATHS (links are minted on view — L-8)', async () => {
    mocks.verifyEvidencePaths.mockResolvedValue(['returns/501/1-a.jpg'])
    await post({ reason: 'damaged', photo_paths: ['returns/501/1-a.jpg'] })
    expect(mocks.verifyEvidencePaths).toHaveBeenCalledTimes(1)
    expect((inserts()[0][2] as { photo_urls: unknown }).photo_urls).toEqual(['returns/501/1-a.jpg'])
  })
})

// VERIFY ROUND (R2-06): the window logic at return/route.ts (item resolution first, window after) had no tests for
// a borrowed variant_id, a replacement still in transit (negative elapsed) or the closed window after a replacement.
describe('return route — replacement window uses the DB item, never the client variant (R2-06)', () => {
  const HOUR = 3_600_000
  const oldDelivery = { ...ORDER, delivered_at: new Date(Date.now() - 30 * 86_400_000).toISOString() }   // original delivery long ago
  const json = async (r: Response) => ({ status: r.status, body: await r.json() })

  it('a borrowed variant_id (the REPLACED item, sent while returning a different item) is ignored — the DB row for the requested item wins → window closed', async () => {
    order = oldDelivery
    // variant 11 was replaced yesterday; the customer asks for order_item 2 (variant 12) but sends variant_id 11 alongside
    returnsRows = [{ variant_id: 11, replacement_shipped_at: new Date(Date.now() - 24 * HOUR).toISOString(), status: 'replaced' }]
    const { status, body } = await json(await post({ reason: 'damaged', order_item_id: 2, variant_id: 11 }))
    expect(status).toBe(422)
    expect(body.error).toMatch(/Return window has closed/)
    expect(inserts()).toHaveLength(0)
  })
  it('negative elapsed time (replacement shipped, not yet expected to arrive) → 422 "still on its way"', async () => {
    order = oldDelivery
    returnsRows = [{ variant_id: 11, replacement_shipped_at: new Date(Date.now() - 1 * HOUR).toISOString(), status: 'replaced' }]
    const { status, body } = await json(await post({ reason: 'damaged', variant_id: 11 }))
    expect(status).toBe(422)
    expect(body.error).toMatch(/still on its way/)
    expect(inserts()).toHaveLength(0)
  })
  it('the replacement opens its own 48 h window: inside → accepted; more than 48 h after it arrived → 422 window closed', async () => {
    const { REPLACEMENT_TRANSIT_DAYS } = await import('@/lib/account/constants')
    order = oldDelivery
    const arrivedHoursAgo = (h: number) => new Date(Date.now() - (REPLACEMENT_TRANSIT_DAYS * 24 + h) * HOUR).toISOString()
    returnsRows = [{ variant_id: 11, replacement_shipped_at: arrivedHoursAgo(47), status: 'replaced' }]
    expect((await post({ reason: 'damaged', variant_id: 11 })).status).toBe(200)
    returnsRows = [{ variant_id: 11, replacement_shipped_at: arrivedHoursAgo(49), status: 'replaced' }]
    const { status, body } = await json(await post({ reason: 'damaged', variant_id: 11 }))
    expect(status).toBe(422)
    expect(body.error).toMatch(/48 hours from delivery of your replacement/)
  })
})

describe('upload-url — only for returnable orders', () => {
  const upload = async () => {
    const { POST } = await import('@/app/api/orders/[id]/return/upload-url/route')
    return POST(new NextRequest('https://pahadiroots.com/api/orders/501/return/upload-url', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://pahadiroots.com' },
      body: JSON.stringify({ fileName: 'a.jpg', fileType: 'image/jpeg', fileSize: 1024 }),
    }), { params: Promise.resolve({ id: '501' }) })
  }
  it.each([
    ['not delivered', { order_status: 'shipped' }],
    ['without delivered_at', { delivered_at: null }],
    ['past the window', { delivered_at: new Date(Date.now() - 10 * 86_400_000).toISOString() }],
  ])('422s for an order that is %s, before any storage call', async (_n, over) => {
    order = { ...ORDER, ...over }
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect((await upload()).status).toBe(422)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

describe('GET /api/orders — status allow-list and paging', () => {
  const get = async (qs: string) => {
    const { GET } = await import('@/app/api/orders/route')
    return GET(new NextRequest(`https://pahadiroots.com/api/orders?${qs}`))
  }
  const ordersPaths = () => mocks.sbAdmin.mock.calls.map(c => String(c[1])).filter(p => p.startsWith('/rest/v1/orders?'))
  beforeEach(() => {
    mocks.sbAdminCount.mockResolvedValue(0)
    mocks.sbAdmin.mockReset()
    mocks.sbAdmin.mockImplementation(async (_m: string, path: string) => (path.includes('/rpc/') ? [{}] : []))
  })

  it('ACTIVE_STATUSES is a subset of the real enum list', () => {
    for (const s of ACTIVE_STATUSES) expect(ORDER_STATUS_VALUES).toContain(s)
  })
  it('the Active tab filter keeps processing and out_for_delivery', async () => {
    expect((await get(`status=${ACTIVE_STATUSES.join(',')}`)).status).toBe(200)
    const p = decodeURIComponent(ordersPaths()[0])
    expect(p).toContain('order_status.eq.processing')
    expect(p).toContain('order_status.eq.out_for_delivery')
  })
  it('filtering only by processing filters (does not return everything)', async () => {
    await get('status=processing')
    expect(decodeURIComponent(ordersPaths()[0])).toContain('or=(order_status.eq.processing)')
  })
  it('rejects an unknown status with 400 and touches nothing', async () => {
    expect((await get('status=pending,bogus')).status).toBe(400)
    expect(mocks.sbAdmin).not.toHaveBeenCalled()
  })
  it('non-numeric page/limit fall back to 1 / 20', async () => {
    expect((await get('page=abc&limit=xyz')).status).toBe(200)
    const p = ordersPaths().find(x => x.includes('limit='))!
    expect(p).toContain('limit=20')
    expect(p).toContain('offset=0')
  })
})
