/**
 * Nov 2026 orders-API audit (F): cancel dispatch re-check + visible follow-up failures, tracking limiter keys and
 * uniform work, invoice status gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  sbAuth: vi.fn(), sbAdmin: vi.fn(), getToken: vi.fn(), tryRefresh: vi.fn(), syncCustomerProfile: vi.fn(),
  checkCsrf: vi.fn(), checkRateLimitShared: vi.fn(), logOrderEvent: vi.fn(), sendTransactionalEmail: vi.fn(),
  checkRateLimitKv: vi.fn(), captureError: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ getServiceClient: () => ({ from: () => { throw new Error('no db in this test') } }) }))
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (cb: () => unknown) => { void cb() } }
})
vi.mock('@/lib/api/serverUtils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    ok: (d: unknown) => NextResponse.json(d),
    fail: (status: number, msg: string) => NextResponse.json({ error: msg }, { status }),
    sbAuth: mocks.sbAuth, sbAdmin: mocks.sbAdmin, getToken: mocks.getToken, tryRefresh: mocks.tryRefresh,
    syncCustomerProfile: mocks.syncCustomerProfile, checkCsrf: mocks.checkCsrf, checkRateLimitShared: mocks.checkRateLimitShared,
    applyNewCookies: (r: NextResponse) => r,
  }
})
vi.mock('@/lib/services/orderService', () => ({ logOrderEvent: mocks.logOrderEvent }))
vi.mock('@/lib/server/email', () => ({ sendTransactionalEmail: mocks.sendTransactionalEmail }))
vi.mock('@/lib/server/catalogFreshness', () => ({ refreshCatalogPages: vi.fn() }))
vi.mock('@/lib/getSiteSettings', () => ({ getFreshSiteSettings: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/api/rateLimitKv', () => ({ checkRateLimitKv: mocks.checkRateLimitKv }))
vi.mock('@/lib/logger', async () => {
  const actual = await vi.importActual<typeof import('@/lib/logger')>('@/lib/logger')
  return { ...actual, captureError: mocks.captureError }
})

const ORDER = { id: 163, order_number: 'ORD-1', order_status: 'confirmed', payment_method: 'cod', payment_status: 'cod_pending', tracking_number: null, shipped_at: null, total_amount: 500 }
let patchRows: unknown[] = [{ id: 163 }]
let rpcFail: string | null = null

beforeEach(() => {
  vi.clearAllMocks()
  patchRows = [{ id: 163 }]; rpcFail = null
  mocks.checkCsrf.mockReturnValue(null); mocks.checkRateLimitShared.mockResolvedValue(true)
  mocks.getToken.mockReturnValue('jwt'); mocks.tryRefresh.mockResolvedValue(null)
  mocks.sbAuth.mockResolvedValue({ id: 'u1', email: 'a@example.com' }); mocks.syncCustomerProfile.mockResolvedValue({ id: 58 })
  mocks.logOrderEvent.mockResolvedValue(undefined); mocks.checkRateLimitKv.mockResolvedValue(true)
  mocks.sbAdmin.mockImplementation(async (m: string, path: string) => {
    if (m === 'GET' && path.startsWith('/rest/v1/orders?id=')) return [ORDER]
    if (m === 'PATCH') return patchRows
    if (rpcFail && path.includes(rpcFail)) throw new Error('rpc down')
    return null
  })
})

const cancel = () => import('@/app/api/orders/[id]/cancel/route').then(({ POST }) =>
  POST(new NextRequest('https://pahadiroots.com/api/orders/163/cancel', {
    method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://pahadiroots.com' }, body: JSON.stringify({ reason: 'changed_mind' }),
  }), { params: Promise.resolve({ id: '163' }) }))

describe('cancel route', () => {
  it('the conditional PATCH also requires no AWB and not shipped (ops may add one after the eligibility read)', async () => {
    await cancel()
    const patch = mocks.sbAdmin.mock.calls.find(c => c[0] === 'PATCH')!
    const path = decodeURIComponent(String(patch[1]))
    expect(path).toContain('order_status=in.(pending,confirmed)')
    expect(path).toContain('tracking_number.is.null')
    expect(path).toContain('shipped_at=is.null')
  })

  it('a dispatched-in-between order (0 rows from the PATCH) -> 409 contact_support', async () => {
    patchRows = []
    const res = await cancel()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('contact_support')
  })

  it('records failed post-commit steps on the order event so ops can finish them', async () => {
    rpcFail = 'reverse_loyalty_for_order'
    const res = await cancel()
    expect(res.status).toBe(200)
    expect(mocks.logOrderEvent).toHaveBeenCalledWith('163', 'customer_cancelled', 'customer',
      expect.objectContaining({ followup_failed: ['loyalty_reversal'], needs_manual_followup: true }))
    expect(mocks.captureError).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'orders.cancel.loyalty_reversal', alert: true }))
  })

  it('no follow-up marker when everything worked', async () => {
    await cancel()
    expect(mocks.logOrderEvent.mock.calls[0][3]).not.toHaveProperty('followup_failed')
  })
})

describe('track route', () => {
  const ROW = { order_number: 'PR1A2B3C4D', order_status: 'shipped', payment_method: 'cod', created_at: '2026-08-01', total_amount: 5, customer_id: 42, shipping_address: { phone: '9876543210' } }
  let order: unknown[] = [ROW]
  const track = async (phone = '9876543210') => {
    const { GET } = await import('@/app/api/v1/orders/track/route')
    return GET(new NextRequest(`https://pahadiroots.com/api/v1/orders/track?order_number=PR1A2B3C4D&phone=${phone}`, { headers: { 'x-forwarded-for': '1.2.3.4' } }))
  }
  beforeEach(() => {
    order = [ROW]
    mocks.sbAdmin.mockReset()
    mocks.sbAdmin.mockImplementation(async (_m: string, path: string) => (path.startsWith('/rest/v1/orders?') ? order : [{ phone: '9876543210' }]))
  })

  it('keys the per-order limiter on order number AND ip, and adds a per-phone limiter', async () => {
    await track()
    const keys = mocks.checkRateLimitKv.mock.calls.map(c => String(c[0]))
    expect(keys.some(k => k.includes('order_track_num') && k.includes('PR1A2B3C4D') && k.includes('1.2.3.4'))).toBe(true)
    expect(keys.some(k => k.includes('order_track_phone') && k.includes('9876543210'))).toBe(true)
  })

  it('429s when the per-phone limiter trips, before touching the DB', async () => {
    mocks.checkRateLimitKv.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    expect((await track()).status).toBe(429)
    expect(mocks.sbAdmin).not.toHaveBeenCalled()
  })

  it('a missing order does the same DB work as a phone mismatch (customers lookup still runs) and answers identically', async () => {
    order = []
    const missing = await track()
    const missingCalls = mocks.sbAdmin.mock.calls.map(c => String(c[1]).split('?')[0])
    mocks.sbAdmin.mockClear()
    order = [{ ...ROW, shipping_address: { phone: '1111111111' } }]
    mocks.sbAdmin.mockImplementation(async (_m: string, path: string) => (path.startsWith('/rest/v1/orders?') ? order : [{ phone: '2222222222' }]))
    const mismatch = await track()
    const mismatchCalls = mocks.sbAdmin.mock.calls.map(c => String(c[1]).split('?')[0])
    expect(missing.status).toBe(404)
    expect(mismatch.status).toBe(404)
    expect(await missing.json()).toEqual(await mismatch.json())
    expect(missingCalls).toEqual(mismatchCalls)
  })

  it('a missing order can never be reported as found even if the dummy lookup matches the phone', async () => {
    order = []
    expect((await track()).status).toBe(404)
  })
})

describe('invoice route status gate', () => {
  const invoice = async (status: string, paymentStatus = 'paid') => {
    mocks.sbAdmin.mockReset()
    mocks.sbAdmin.mockImplementation(async (_m: string, path: string) => {
      if (path.startsWith('/rest/v1/orders?')) return [{ id: 9, order_number: 'X', order_status: status, payment_status: paymentStatus, order_items: [], total_amount: 100, created_at: '2026-09-01T00:00:00Z', shipping_address: {} }]
      return []
    })
    const { GET } = await import('@/app/api/orders/[id]/invoice/route')
    return GET(new NextRequest('https://pahadiroots.com/api/orders/9/invoice'), { params: Promise.resolve({ id: '9' }) })
  }
  it.each(['pending', 'cancelled', 'payment_failed'])('409s for a %s order', async (s) => {
    expect((await invoice(s)).status).toBe(409)
  })
  it.each(['confirmed', 'delivered', 'shipped', 'processing'])('renders for a %s order', async (s) => {
    expect((await invoice(s)).status).toBe(200)
  })
  // R4-03: the supply was reversed — the original tax invoice is no longer valid (a credit note is), so it is refused too.
  // The route answers text/plain (not JSON) so the browser shows the message as-is.
  it.each(['returned', 'RETURNED', 'return_requested', 'return_approved', 'refunded', 'refund_pending', 'refund_initiated'])(
    '409s with the credit-note message for a %s order', async (s) => {
      const res = await invoice(s)
      expect(res.status).toBe(409)
      expect(res.headers.get('content-type')).toMatch(/text\/plain/)
      expect(await res.text()).toMatch(/returned or refunded.*credit note/i)
    })
  // Nov 2026 verification: a return lives in the `returns` table and the order stays 'delivered'; only payment_status
  // becomes 'refunded'. Production had 10 such orders still printing a full GST invoice.
  it('409s for a delivered order whose payment was refunded', async () => {
    const res = await invoice('delivered', 'refunded')
    expect(res.status).toBe(409)
    expect(await res.text()).toMatch(/returned or refunded.*credit note/i)
  })
  it('still renders for a delivered COD order (payment not refunded)', async () => {
    expect((await invoice('delivered', 'cod_pending')).status).toBe(200)
  })
})
