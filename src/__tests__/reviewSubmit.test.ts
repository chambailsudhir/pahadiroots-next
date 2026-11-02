/**
 * Verified-purchase reviews: POST /api/v1/actions {action:'submit_review'} and GET /api/v1/reviews/eligible.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  sbAuth: vi.fn(), sbAdmin: vi.fn(), getToken: vi.fn(), tryRefresh: vi.fn(), applyNewCookies: vi.fn(),
  syncCustomerProfile: vi.fn(), checkRateLimitShared: vi.fn(), checkCsrf: vi.fn(), checkRateLimitKv: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/api/serverUtils', () => ({
  sbAuth: m.sbAuth, sbAdmin: m.sbAdmin, getToken: m.getToken, tryRefresh: m.tryRefresh, applyNewCookies: m.applyNewCookies,
  syncCustomerProfile: m.syncCustomerProfile, checkRateLimitShared: m.checkRateLimitShared, checkCsrf: m.checkCsrf,
}))
vi.mock('@/lib/api/rateLimitKv', () => ({ checkRateLimitKv: m.checkRateLimitKv }))
vi.mock('@/lib/supabase', () => ({ supabase: {}, getServiceClient: () => ({}) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, captureError: vi.fn() }))
vi.mock('@/lib/server/email', () => ({ sendTransactionalEmail: vi.fn() }))

const post = (body: unknown) => new NextRequest('https://pahadiroots.com/api/v1/actions', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://pahadiroots.com' },
  body: JSON.stringify({ action: 'submit_review', ...(body as object) }),
})
const valid = { product_id: 11, order_id: 501, rating: 5, comment: 'Lovely honey' }

let orderRow: Record<string, unknown> | null
let itemRows: unknown[]
let existing: unknown[]
let insertErr: unknown
const calls = () => m.sbAdmin.mock.calls as Array<[string, string, Record<string, unknown>?]>
const insert = () => calls().find(([meth, p]) => meth === 'POST' && p === '/rest/v1/reviews')

beforeEach(() => {
  vi.clearAllMocks()
  orderRow = { id: 501, order_status: 'delivered' }; itemRows = [{ product_id: 11 }]; existing = []; insertErr = null
  m.checkCsrf.mockReturnValue(null)
  m.checkRateLimitKv.mockResolvedValue(true)
  m.checkRateLimitShared.mockResolvedValue(true)
  m.getToken.mockReturnValue('jwt'); m.tryRefresh.mockResolvedValue(null)
  m.sbAuth.mockResolvedValue({ id: 'auth-1', email: 'a@x.com' })
  m.syncCustomerProfile.mockResolvedValue({ id: 42, first_name: 'Priya', last_name: 'sharma' })
  m.sbAdmin.mockImplementation(async (meth: string, path: string) => {
    if (path.startsWith('/rest/v1/orders?')) return orderRow ? [orderRow] : []
    if (path.startsWith('/rest/v1/order_items?')) return itemRows
    if (path.startsWith('/rest/v1/reviews?')) return existing
    if (meth === 'POST' && path === '/rest/v1/reviews') { if (insertErr) throw insertErr; return null }
    return []
  })
})

async function submit(body: unknown) {
  const { POST } = await import('@/app/api/v1/actions/route')
  return POST(post(body))
}

describe('submit_review (verified purchase)', () => {
  it('stores a pending verified review tied to the session customer and order, with a server-built name', async () => {
    const res = await submit({ ...valid, customer_name: 'Hacker', customer_id: 999, comment: ' <b>Lovely</b> honey ' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, message: 'Review submitted for approval' })
    const row = insert()![2]!
    expect(row).toMatchObject({
      product_id: 11, customer_id: 42, order_id: 501, is_verified_purchase: true, customer_name: 'Priya S.',
      rating: 5, review_text: 'Lovely honey', comment: 'Lovely honey', status: 'pending',
    })
    expect(JSON.stringify(row)).not.toContain('Hacker')
    // the order lookup is owner-scoped
    expect(calls().find(([, p]) => p.startsWith('/rest/v1/orders?'))![1]).toContain('customer_id=eq.42')
  })

  it('401 without a session, and nothing is read or written', async () => {
    m.getToken.mockReturnValue(null)
    const res = await submit(valid)
    expect(res.status).toBe(401)
    expect(m.sbAdmin).not.toHaveBeenCalled()
  })

  it('401 when the session token is revoked', async () => {
    m.sbAuth.mockRejectedValue({ status: 401, message: 'x' })
    expect((await submit(valid)).status).toBe(401)
  })

  it('refuses a missing order_id and invalid ratings (400)', async () => {
    expect((await submit({ product_id: 11, rating: 5 })).status).toBe(400)
    for (const rating of [0, 6, 3.5, '5']) expect((await submit({ ...valid, rating })).status).toBe(400)
    expect(insert()).toBeUndefined()
  })

  it('404 for an order that is not the customer’s (or does not exist)', async () => {
    orderRow = null
    const res = await submit(valid)
    expect(res.status).toBe(404)
    expect(insert()).toBeUndefined()
  })

  it('409 order_not_delivered unless the order is delivered', async () => {
    for (const s of ['pending', 'confirmed', 'shipped', 'out_for_delivery', 'cancelled', 'returned']) {
      orderRow = { id: 501, order_status: s }
      const res = await submit(valid)
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('order_not_delivered')
    }
    expect(insert()).toBeUndefined()
  })

  it('400 when the product is not in that order', async () => {
    itemRows = []
    const res = await submit(valid)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('product_not_in_order')
    expect(insert()).toBeUndefined()
  })

  it('409 when the customer already reviewed the product (pre-check and unique-index race)', async () => {
    existing = [{ id: 'r1' }]
    let res = await submit(valid)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('already_reviewed')
    expect(insert()).toBeUndefined()

    existing = []; insertErr = { status: 409, message: '{"code":"23505"}' }
    res = await submit(valid)
    expect(res.status).toBe(409)
  })

  it('caps the comment at 1000 characters and strips tags; empty comment is stored as null', async () => {
    await submit({ ...valid, comment: '<script>x</script>' + 'a'.repeat(2000) })
    expect(String(insert()![2]!.review_text).length).toBe(1000)
    expect(String(insert()![2]!.review_text)).not.toContain('<')
    m.sbAdmin.mockClear()
    await submit({ ...valid, comment: '   ' })
    expect(insert()![2]!.review_text).toBeNull()
  })

  it('429 when the per-customer shared limit is hit', async () => {
    m.checkRateLimitShared.mockResolvedValue(false)
    const res = await submit(valid)
    expect(res.status).toBe(429)
    expect(m.checkRateLimitShared.mock.calls[0][0]).toBe('review_submit:42')
    expect(insert()).toBeUndefined()
  })

  it('503 (not a thrown 500) when the database is unavailable, e.g. migration not applied', async () => {
    m.sbAdmin.mockImplementation(async (_m: string, path: string) => {
      if (path.startsWith('/rest/v1/orders?')) return [orderRow]
      if (path.startsWith('/rest/v1/order_items?')) return itemRows
      throw { status: 400, message: 'column reviews.customer_id does not exist' }
    })
    expect((await submit(valid)).status).toBe(503)
  })
})

describe('GET /api/v1/reviews/eligible', () => {
  const get = async (q: string) => {
    const { GET } = await import('@/app/api/v1/reviews/eligible/route')
    return GET(new NextRequest(`https://pahadiroots.com/api/v1/reviews/eligible${q}`))
  }

  it('lists the order’s products once each with already_reviewed, scoped to the owner', async () => {
    m.sbAdmin.mockImplementation(async (_m: string, path: string) => {
      if (path.startsWith('/rest/v1/orders?')) return [{ id: 501, order_number: 'ORD-1', order_status: 'delivered' }]
      if (path.startsWith('/rest/v1/order_items?')) return [
        { product_id: 11, product_name_snapshot: 'Honey', products: { name: 'Honey', image_url: 'https://img/h.jpg' } },
        { product_id: 11, product_name_snapshot: 'Honey', products: { name: 'Honey', image_url: 'https://img/h.jpg' } },
        { product_id: 12, product_name_snapshot: null, products: { name: 'Ghee', image_url: null } },
      ]
      if (path.startsWith('/rest/v1/reviews?')) return [{ product_id: 12 }]
      return []
    })
    const res = await get('?order_id=501')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    const json = await res.json()
    expect(json.delivered).toBe(true)
    expect(json.items).toEqual([
      { product_id: 11, name: 'Honey', image: 'https://img/h.jpg', already_reviewed: false },
      { product_id: 12, name: 'Ghee', image: null, already_reviewed: true },
    ])
    expect(calls().find(([, p]) => p.startsWith('/rest/v1/orders?'))![1]).toContain('customer_id=eq.42')
  })

  it('returns no items for an undelivered order, 404 for a foreign one, 400 for a bad id, 401 signed out', async () => {
    m.sbAdmin.mockResolvedValue([{ id: 501, order_number: 'ORD-1', order_status: 'shipped' }])
    expect(await (await get('?order_id=501')).json()).toMatchObject({ delivered: false, items: [] })
    m.sbAdmin.mockResolvedValue([])
    expect((await get('?order_id=501')).status).toBe(404)
    expect((await get('?order_id=abc')).status).toBe(400)
    m.getToken.mockReturnValue(null)
    expect((await get('?order_id=501')).status).toBe(401)
  })
})
