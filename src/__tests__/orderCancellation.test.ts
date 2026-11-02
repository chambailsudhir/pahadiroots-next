/**
 * AUDIT ACC-050 — customer self-service cancellation: eligibility rules + POST /api/orders/[id]/cancel.
 * Live finding: no self-serve cancellation existed anywhere (UI or API); customers had to use WhatsApp.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { cancelEligibility, CANCEL_REASON_CODES } from '@/lib/orderCancellation'

describe('cancelEligibility', () => {
  const cod = { payment_method: 'cod', payment_status: 'cod_pending' }

  it.each(['pending', 'confirmed'])('allows a COD order that is %s', (order_status) => {
    expect(cancelEligibility({ ...cod, order_status })).toEqual({ allowed: true })
  })

  it.each(['processing', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'returned', 'payment_failed'])(
    'sends a COD order that is %s to support (never self-serve)', (order_status) => {
      const v = cancelEligibility({ ...cod, order_status })
      expect(v.allowed).toBe(false)
      expect((v as { reason: string }).reason).toBe('contact_support')
    })

  it('treats an already-cancelled order as not cancellable', () => {
    const v = cancelEligibility({ ...cod, order_status: 'cancelled' })
    expect(v).toMatchObject({ allowed: false, reason: 'not_cancellable' })
  })

  it('a prepaid order (money moved / Razorpay can still capture) goes to support even when confirmed', () => {
    for (const payment_status of ['paid', 'pending', 'authorized']) {
      const v = cancelEligibility({ order_status: 'confirmed', payment_method: 'razorpay', payment_status })
      expect(v).toMatchObject({ allowed: false, reason: 'contact_support' })
    }
  })

  it('a tracking number or shipped_at means it left the building — support, whatever the status says', () => {
    expect(cancelEligibility({ ...cod, order_status: 'confirmed', tracking_number: 'AWB123' }).allowed).toBe(false)
    expect(cancelEligibility({ ...cod, order_status: 'confirmed', shipped_at: '2026-11-02T00:00:00Z' }).allowed).toBe(false)
  })

  it('is tolerant of null / odd values coming from a DB row', () => {
    expect(cancelEligibility({ order_status: null }).allowed).toBe(false)
    expect(cancelEligibility({ order_status: 'CONFIRMED', payment_method: 'COD' }).allowed).toBe(true)
  })
})

// ── route ────────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  sbAuth: vi.fn(), sbAdmin: vi.fn(), getToken: vi.fn(), tryRefresh: vi.fn(), syncCustomerProfile: vi.fn(),
  checkCsrf: vi.fn(), checkRateLimitShared: vi.fn(), logOrderEvent: vi.fn(), sendTransactionalEmail: vi.fn(),
}))
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (cb: () => unknown) => { void cb() } }
})
vi.mock('@/lib/api/serverUtils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    ok:   (d: unknown) => NextResponse.json(d),
    fail: (status: number, msg: string, headers?: Record<string, string>) => NextResponse.json({ error: msg }, { status, headers }),
    sbAuth: mocks.sbAuth, sbAdmin: mocks.sbAdmin, getToken: mocks.getToken, tryRefresh: mocks.tryRefresh,
    syncCustomerProfile: mocks.syncCustomerProfile, checkCsrf: mocks.checkCsrf, checkRateLimitShared: mocks.checkRateLimitShared,
    applyNewCookies: (r: NextResponse) => r,
  }
})
vi.mock('@/lib/services/orderService', () => ({ logOrderEvent: mocks.logOrderEvent }))
vi.mock('@/lib/server/email', () => ({ sendTransactionalEmail: mocks.sendTransactionalEmail }))
vi.mock('@/lib/server/catalogFreshness', () => ({ refreshCatalogPages: vi.fn() }))
vi.mock('@/lib/getSiteSettings', () => ({ getFreshSiteSettings: vi.fn().mockResolvedValue({ admin_notify_email: 'ops@example.com' }) }))

const ORDER = { id: 163, order_number: 'ORD-2026-00140', order_status: 'confirmed', payment_method: 'cod', payment_status: 'cod_pending', tracking_number: null, shipped_at: null, total_amount: 500 }
const call = (id = '163', body: unknown = { reason: 'changed_mind' }) =>
  import('@/app/api/orders/[id]/cancel/route').then(({ POST }) =>
    POST(new NextRequest(`https://pahadiroots.com/api/orders/${id}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://pahadiroots.com' }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id }) }))

let orderRows: unknown[] = [ORDER]
let patchRows: unknown[] = [{ id: 163 }]
const adminCalls = () => mocks.sbAdmin.mock.calls as Array<[string, string, unknown?]>

beforeEach(() => {
  vi.clearAllMocks()
  orderRows = [ORDER]; patchRows = [{ id: 163 }]
  mocks.checkCsrf.mockReturnValue(null)
  mocks.checkRateLimitShared.mockResolvedValue(true)
  mocks.getToken.mockReturnValue('jwt'); mocks.tryRefresh.mockResolvedValue(null)
  mocks.sbAuth.mockResolvedValue({ id: 'u1', email: 'asha@example.com' })
  mocks.syncCustomerProfile.mockResolvedValue({ id: 58 })
  mocks.logOrderEvent.mockResolvedValue(undefined)
  mocks.sbAdmin.mockImplementation(async (m: string, path: string) => {
    if (m === 'GET' && path.startsWith('/rest/v1/orders?id=')) return orderRows
    if (m === 'PATCH' && path.startsWith('/rest/v1/orders?id=')) return patchRows
    if (path.includes('/rpc/release_coupon_for_order')) return { released: true }
    if (path.includes('/rpc/reverse_loyalty_for_order')) return { reversed: true }
    return null
  })
})

describe('POST /api/orders/[id]/cancel', () => {
  it('cancels an eligible COD order with a CONDITIONAL, owner-scoped update, then releases coupon + reverses loyalty', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, status: 'cancelled', order_number: 'ORD-2026-00140' })

    const patch = adminCalls().find(([m, p]) => m === 'PATCH' && p.startsWith('/rest/v1/orders?id='))!
    expect(patch[1]).toContain('id=eq.163')
    expect(patch[1]).toContain('customer_id=eq.58')                      // IDOR guard on the write too
    expect(patch[1]).toContain('order_status=in.(pending,confirmed)')    // single winner
    expect(patch[2]).toMatchObject({ order_status: 'cancelled' })

    expect(adminCalls().some(([m, p, b]) => m === 'POST' && p.includes('release_coupon_for_order') && (b as { p_order_id: number }).p_order_id === 163)).toBe(true)
    expect(adminCalls().some(([m, p, b]) => m === 'POST' && p.includes('reverse_loyalty_for_order') && (b as { p_order_id: number }).p_order_id === 163)).toBe(true)
    expect(mocks.logOrderEvent).toHaveBeenCalledWith('163', 'customer_cancelled', 'customer', expect.objectContaining({ reason: 'changed_mind' }))
  })

  it('emails the customer and the admin after cancelling', async () => {
    await call()
    await new Promise(r => setTimeout(r, 0))   // `after()` is mocked as fire-and-forget — let the queued e-mail work finish
    const types = mocks.sendTransactionalEmail.mock.calls.map(c => [c[0].type, c[0].to])
    expect(types).toContainEqual(['order_cancelled', 'asha@example.com'])
    expect(types).toContainEqual(['admin_order_notify', 'ops@example.com'])
  })

  it("404s for an order that is not the caller's (identical to 'does not exist') and writes nothing", async () => {
    orderRows = []
    const res = await call('164')
    expect(res.status).toBe(404)
    expect(adminCalls().some(([m]) => m === 'PATCH')).toBe(false)
  })

  it('409 `contact_support` for a prepaid order — nothing is changed', async () => {
    orderRows = [{ ...ORDER, payment_method: 'razorpay', payment_status: 'paid' }]
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('contact_support')
    expect(adminCalls().some(([m]) => m === 'PATCH')).toBe(false)
  })

  it('409 for an order that is already being packed', async () => {
    orderRows = [{ ...ORDER, order_status: 'packed' }]
    const res = await call()
    expect(res.status).toBe(409)
    expect(adminCalls().some(([m]) => m === 'PATCH')).toBe(false)
  })

  it('409 (not 200) when a packer got there first: the conditional update changed 0 rows — no coupon / coin side effects', async () => {
    patchRows = []
    const res = await call()
    expect(res.status).toBe(409)
    expect(adminCalls().some(([, p]) => p.includes('/rpc/'))).toBe(false)
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled()
  })

  it('maps a DB state-machine refusal to the same 409', async () => {
    mocks.sbAdmin.mockImplementation(async (m: string, path: string) => {
      if (m === 'GET') return orderRows
      if (m === 'PATCH') throw { status: 400, message: 'Order status transition packed -> cancelled is not allowed' }
      return null
    })
    expect((await call()).status).toBe(409)
  })

  it('still reports success when the coupon / loyalty follow-ups fail (the order IS cancelled)', async () => {
    mocks.sbAdmin.mockImplementation(async (m: string, path: string) => {
      if (m === 'GET') return orderRows
      if (m === 'PATCH') return patchRows
      throw { status: 500, message: 'rpc down' }
    })
    const res = await call()
    expect(res.status).toBe(200)
  })

  it.each([
    ['missing reason', {}],
    ['unknown reason', { reason: 'because' }],
    ['non-string reason', { reason: 5 }],
  ])('400s for %s', async (_l, body) => {
    expect((await call('163', body)).status).toBe(400)
    expect(adminCalls().some(([m]) => m === 'PATCH')).toBe(false)
  })

  it('400s for a malformed id and 401s when logged out', async () => {
    expect((await call('1;drop')).status).toBe(400)
    mocks.getToken.mockReturnValue(null)
    expect((await call()).status).toBe(401)
  })

  it('403 via CSRF check and 429 when the per-account limit is hit', async () => {
    mocks.checkCsrf.mockReturnValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await call()).status).toBe(403)
    mocks.checkCsrf.mockReturnValue(null)
    mocks.checkRateLimitShared.mockResolvedValue(false)
    expect((await call()).status).toBe(429)
  })

  it('every offered reason code is accepted', async () => {
    for (const reason of CANCEL_REASON_CODES) {
      vi.clearAllMocks(); mocks.checkCsrf.mockReturnValue(null); mocks.checkRateLimitShared.mockResolvedValue(true)
      mocks.getToken.mockReturnValue('jwt'); mocks.sbAuth.mockResolvedValue({ id: 'u1', email: 'a@b.com' }); mocks.syncCustomerProfile.mockResolvedValue({ id: 58 })
      mocks.sbAdmin.mockImplementation(async (m: string) => (m === 'GET' ? [ORDER] : m === 'PATCH' ? [{ id: 163 }] : null))
      expect((await call('163', { reason })).status).toBe(200)
    }
  })
})
