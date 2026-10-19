/**
 * ordersListRoute.test.ts — GET /api/orders (the account "My Orders" list).
 *
 * INCIDENT (Oct 2026): the page showed "92 orders" and full stats above "No orders yet".
 *   • Migration 055 added a second foreign key order_items → product_variants (composite variant_id, product_id).
 *   • The list query embedded `product_variants(variant_value)` from order_items. With two relationships PostgREST
 *     answers 300 / PGRST201 (ambiguous embed).
 *   • The route ended that query in `.catch(() => [])`, so the error became an empty list — while the separate
 *     count query and the stats RPC still succeeded.
 * There was no test for this route, which is why nothing caught it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { RETURNS_FILTER_SENTINEL } from '@/lib/account/constants'

const mocks = vi.hoisted(() => ({
  sbAdmin: vi.fn(), sbAdminCount: vi.fn(), sbAuth: vi.fn(), getToken: vi.fn(),
  tryRefresh: vi.fn(), syncCustomerProfile: vi.fn(), applyNewCookies: vi.fn(),
}))

vi.mock('@/lib/api/serverUtils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    ok:   (data: unknown) => NextResponse.json(data),
    fail: (status: number, msg: string) => NextResponse.json({ error: msg }, { status }),
    ...mocks,
  }
})

const PROFILE = { id: 'cust-1' }
const AMBIGUOUS = { status: 300, message: '{"code":"PGRST201","message":"Could not embed because more than one relationship was found for \'order_items\' and \'product_variants\'"}' }

const baseOrder = (id: number, items: unknown[] = []) => ({
  id, order_number: `PR-${id}`, order_status: 'delivered', payment_method: 'razorpay', payment_status: 'paid',
  total_amount: 499, created_at: '2026-09-01T10:00:00Z', tracking_number: null, courier: null, shipped_at: null,
  delivered_at: null, updated_at: null, loyalty_points_earned: 0, loyalty_points_redeemed: 0,
  order_items: items, returns: [],
})
const line = (over: Record<string, unknown> = {}) => ({
  id: 1, quantity: 1, price_at_time: 499, product_name_snapshot: null, variant_value_snapshot: null,
  product_id: 7, variant_id: 11, products: { name: 'Spiti Honey', emoji: '🍯', image_url: '/h.jpg' }, ...over,
})

type RowsBehaviour = (path: string) => unknown | Promise<unknown>
function wire(rows: RowsBehaviour, variants: RowsBehaviour = () => []) {
  mocks.sbAdmin.mockImplementation(async (_m: string, path: string) => {
    if (path.includes('/rpc/get_customer_order_stats')) return [{ delivered: 70, active: 5, cancelled: 9, spent: 33100.32, loyalty_points: 0 }]
    if (path.includes('/rest/v1/site_settings')) return []
    if (path.includes('/rest/v1/product_variants?')) return variants(path)
    if (path.includes('/rest/v1/orders?')) return rows(path)
    throw new Error(`Unexpected sbAdmin call: ${path}`)
  })
}
const call = async (qs = 'page=1&limit=20') => {
  const { GET } = await import('@/app/api/orders/route')
  const res = await GET(new NextRequest(`https://pahadiroots.com/api/orders?${qs}`))
  return { res, body: await res.json() }
}
const rowsPaths = () => mocks.sbAdmin.mock.calls.map(c => String(c[1])).filter(p => p.includes('/rest/v1/orders?'))

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.getToken.mockReturnValue('tok')
  mocks.tryRefresh.mockResolvedValue(null)
  mocks.sbAuth.mockResolvedValue({ id: 'auth-1' })
  mocks.syncCustomerProfile.mockResolvedValue(PROFILE)
  mocks.sbAdminCount.mockResolvedValue(92)
})

describe('GET /api/orders — the incident', () => {
  it('does NOT embed product_variants in the rows query (ambiguous since migration 055)', async () => {
    wire(() => [baseOrder(1, [line()])])
    await call()
    const [path] = rowsPaths()
    expect(path).toContain('order_items(')
    expect(path).not.toMatch(/product_variants\s*\(/)
  })

  it('a rows query that fails with the ambiguous-embed error still returns the customer\'s orders (degraded, never an empty list)', async () => {
    wire(path => { if (path.includes('order_items(')) throw AMBIGUOUS; return [baseOrder(1), baseOrder(2)] })
    const { res, body } = await call()
    expect(res.status).toBe(200)
    expect(body.total).toBe(92)
    expect(body.orders.map((o: { id: number }) => o.id)).toEqual([1, 2])
    expect(body.orders[0].items).toEqual([])
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('rows query with embeds FAILED'), 'cust-1', '-', AMBIGUOUS)
  })

  it('never answers 200 with an empty list when the rows cannot be read: it is a 500 the UI can retry', async () => {
    wire(() => { throw AMBIGUOUS })
    const { res, body } = await call()
    expect(res.status).toBe(500)
    expect(body.orders).toBeUndefined()
  })

  it('Returns tab: an embed failure is an error (500), not a fake empty tab', async () => {
    wire(() => { throw AMBIGUOUS })
    const { res } = await call(`page=1&limit=20&status=${RETURNS_FILTER_SENTINEL}`)
    expect(res.status).toBe(500)
  })
})

describe('GET /api/orders — variant labels without the embed', () => {
  it('looks up labels with a plain second query for lines that have no snapshot (older orders)', async () => {
    wire(() => [baseOrder(1, [line({ variant_id: 11 }), line({ id: 2, variant_id: 12 })])],
         () => [{ id: 11, variant_value: '500g' }, { id: 12, variant_value: '1kg' }])
    const { body } = await call()
    expect(body.orders[0].items.map((i: { variant: string }) => i.variant)).toEqual(['500g', '1kg'])
    const lookup = mocks.sbAdmin.mock.calls.map(c => String(c[1])).find(p => p.includes('/rest/v1/product_variants?'))!
    expect(lookup).toBe('/rest/v1/product_variants?id=in.(11,12)&select=id,variant_value')
  })

  it('does not look up variants that already have a snapshot, and prefers the snapshot', async () => {
    wire(() => [baseOrder(1, [line({ variant_value_snapshot: '250g', variant_id: 11 })])])
    const { body } = await call()
    expect(body.orders[0].items[0].variant).toBe('250g')
    expect(mocks.sbAdmin.mock.calls.some(c => String(c[1]).includes('/rest/v1/product_variants?'))).toBe(false)
  })

  it('a failing label lookup omits the labels but still returns the orders', async () => {
    wire(() => [baseOrder(1, [line()])], () => { throw { status: 500, message: 'boom' } })
    const { res, body } = await call()
    expect(res.status).toBe(200)
    expect(body.orders).toHaveLength(1)
    expect(body.orders[0].items[0].variant).toBeNull()
    expect(body.orders[0].items[0].name).toBe('Spiti Honey')
  })

  it('shape is unchanged for the account UI (total, pages, stats, item fields)', async () => {
    wire(() => [baseOrder(1, [line({ variant_value_snapshot: '250g' })])])
    const { body } = await call()
    expect(body).toMatchObject({ success: true, total: 92, page: 1, pages: 5, stats: { delivered: 70, active: 5, cancelled: 9, spent: 33100.32 } })
    expect(body.orders[0].items[0]).toMatchObject({ id: 1, qty: 1, price: 499, name: 'Spiti Honey', variant: '250g', variant_id: 11, product_id: 7, emoji: '🍯' })
  })
})
