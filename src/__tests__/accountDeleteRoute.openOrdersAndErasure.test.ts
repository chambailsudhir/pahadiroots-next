/**
 * Account deletion: in-flight orders block it (409), closed orders keep their recipient snapshot, the extra PII tables are
 * erased, the audit row holds a hashed IP, and the "deleted" e-mail is only sent after the auth user is really gone.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  sbAuth: vi.fn(), sbAdmin: vi.fn(), getToken: vi.fn(), tryRefresh: vi.fn(),
  checkRateLimit: vi.fn(), checkRateLimitShared: vi.fn(), checkCsrf: vi.fn(),
}))
vi.mock('@/lib/api/serverUtils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    ok:   (data: unknown) => NextResponse.json(data),
    fail: (status: number, msg: string, headers?: Record<string, string>) => NextResponse.json({ error: msg }, { status, headers }),
    sbAuth: mocks.sbAuth, sbAdmin: mocks.sbAdmin, getToken: mocks.getToken, tryRefresh: mocks.tryRefresh,
    checkRateLimit: mocks.checkRateLimit, checkRateLimitShared: mocks.checkRateLimitShared,
    checkCsrf: mocks.checkCsrf, applyNewCookies: (res: NextResponse) => res,
  }
})

const fetchMock = vi.fn()
beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'service')
  vi.stubEnv('RESEND_API_KEY', 'resend')
  vi.stubGlobal('fetch', fetchMock)
})

const req = () => new NextRequest('https://pahadiroots.com/api/account/delete', {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.7', origin: 'https://pahadiroots.com' },
  body: JSON.stringify({ confirm: 'DELETE', password: 'Correct-Horse-9!' }),
})

const USER = { id: 'auth-uuid', email: 'Asha@Example.com', app_metadata: { provider: 'email', providers: ['email'] } }
let openOrders: unknown[] = []
let authDeleteStatus = 200
const calls = () => mocks.sbAdmin.mock.calls as Array<[string, string, unknown?]>
const urls = () => fetchMock.mock.calls.map(([u]) => String(u))

beforeEach(() => {
  vi.clearAllMocks()
  openOrders = []; authDeleteStatus = 200
  mocks.checkCsrf.mockReturnValue(null)
  mocks.checkRateLimit.mockReturnValue(true)
  mocks.checkRateLimitShared.mockResolvedValue(true)
  mocks.getToken.mockReturnValue('jwt')
  mocks.tryRefresh.mockResolvedValue(null)
  mocks.sbAuth.mockImplementation(async (path: string) => (path.startsWith('/token') ? { access_token: 'x' } : USER))
  mocks.sbAdmin.mockImplementation(async (m: string, path: string) => {
    if (path.startsWith('/rest/v1/customers?auth_user_id=')) return [{ id: 42, email: 'asha@example.com' }]
    if (path.includes('order_status=not.in.')) return openOrders
    if (m === 'GET' && path.startsWith('/rest/v1/orders?customer_id=eq.42&select=id')) return [{ id: 7 }, { id: 8 }]
    if (m === 'PATCH' && path.startsWith('/rest/v1/customers?id=')) return [{ id: 42, auth_user_id: null }]
    return []
  })
  fetchMock.mockImplementation(async (u: string, init?: { method?: string }) => {
    const url = String(u)
    if (url.includes('/auth/v1/admin/users/')) return { ok: authDeleteStatus < 400, status: authDeleteStatus, text: async () => '' }
    if (url.includes('/storage/v1/object/list/')) return { ok: true, status: 200, json: async () => [{ name: '1-a.jpg' }] }
    return { ok: true, status: 200, text: async () => '', json: async () => ({}) , method: init?.method }
  })
})

describe('DELETE /api/account/delete — open orders', () => {
  it('answers 409 and erases NOTHING while an order is non-terminal', async () => {
    openOrders = [{ id: 7 }]
    const { DELETE } = await import('@/app/api/account/delete/route')
    const res = await DELETE(req())
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('open_orders')
    expect(calls().some(([m]) => m !== 'GET')).toBe(false)
    expect(urls().some(u => u.includes('/auth/v1/admin/users/'))).toBe(false)
    const q = calls().find(([, p]) => p.includes('order_status=not.in.'))![1]
    for (const t of ['delivered', 'cancelled', 'refunded']) expect(q).toContain(t)
    for (const t of ['shipped', 'packed', 'confirmed', 'return_requested']) expect(q).not.toContain(t)
  })
})

describe('DELETE /api/account/delete — erasure scope', () => {
  it('clears notes / returns / ledger notes / subscriptions, deletes photos', async () => {
    const { DELETE } = await import('@/app/api/account/delete/route')
    const res = await DELETE(req())
    expect(res.status).toBe(200)
    expect(calls().some(([m, p, b]) => m === 'PATCH' && p === '/rest/v1/orders?customer_id=eq.42' && (b as { notes: null }).notes === null)).toBe(true)
    expect(calls().some(([m, p, b]) => m === 'PATCH' && p.startsWith('/rest/v1/returns?order_id=in.(7,8)') && (b as { photo_urls: null }).photo_urls === null)).toBe(true)
    expect(calls().some(([m, p]) => m === 'PATCH' && p.startsWith('/rest/v1/loyalty_transactions?customer_id=eq.42'))).toBe(true)
    for (const t of ['subscribers?email=eq.', 'stock_notifications?email=eq.', 'failed_emails?to_email=eq.']) {
      expect(calls().some(([m, p]) => m === 'DELETE' && p.includes(t + 'asha%40example.com'))).toBe(true)
    }
    expect(calls().some(([, p]) => p.includes('failed_emails') && p.includes('status=in.(pending,retrying)'))).toBe(true)
    expect(urls().filter(u => u.includes('/storage/v1/object/list/return-evidence'))).toHaveLength(2)
    const del = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith('/storage/v1/object/return-evidence') && i?.method === 'DELETE')
    expect(del).toBeTruthy()
    const patch = calls().find(([m, p]) => m === 'PATCH' && p.startsWith('/rest/v1/customers?id='))![2] as Record<string, unknown>
    expect(patch).toMatchObject({ referral_code: null, tags: [], source: null })
    expect((await res.json()).message).toMatch(/retained/i)
  })

  const FULL_ADDR = { name: 'Asha K', phone: '9876543210', email: 'asha@example.com', address_line1: '1 Hill Rd', address_line2: 'Near temple', city: 'Shimla', state: 'Himachal Pradesh', pincode: '171001', gstin: '02ABCDE1234F1Z5', landmark: 'blue gate', lat: 31.1, lng: 77.1 }
  function withOrders(rows: Array<{ id: number; shipping_address: unknown }>) {
    const base = mocks.sbAdmin.getMockImplementation()!
    mocks.sbAdmin.mockImplementation(async (m: string, path: string, b?: unknown, pref?: string) => {
      if (m === 'GET' && path.includes('order_status=in.(') && path.includes('shipping_address')) return rows
      return base(m, path, b, pref)
    })
  }
  const addrPatches = () => calls().filter(([m, p, b]) => m === 'PATCH' && p.startsWith('/rest/v1/orders?id=eq.') && b && 'shipping_address' in (b as object))

  it('reduces shipping_address of closed orders to the invoice set and keeps state + pincode (GST trigger)', async () => {
    withOrders([{ id: 7, shipping_address: FULL_ADDR }])
    const { DELETE } = await import('@/app/api/account/delete/route')
    expect((await DELETE(req())).status).toBe(200)
    const patches = addrPatches()
    expect(patches).toHaveLength(1)
    expect(patches[0][1]).toBe('/rest/v1/orders?id=eq.7')
    const written = (patches[0][2] as { shipping_address: Record<string, unknown> }).shipping_address
    expect(written).toEqual({ name: 'Asha K', address_line1: '1 Hill Rd', address_line2: 'Near temple', city: 'Shimla', state: 'Himachal Pradesh', pincode: '171001', gstin: '02ABCDE1234F1Z5' })
    for (const k of ['phone', 'email', 'landmark', 'lat', 'lng']) expect(written).not.toHaveProperty(k)
    // only terminal orders are read
    const q = calls().find(([, p]) => p.includes('order_status=in.(') && p.includes('shipping_address'))![1]
    expect(q).toContain('delivered'); expect(q).not.toContain('shipped')
  })

  it('does not add gstin to consumer orders, handles JSON-string snapshots, and is idempotent', async () => {
    withOrders([
      { id: 7, shipping_address: JSON.stringify({ name: 'B', phone: '1', city: 'X', state: 'Delhi', pincode: '110001' }) },
      { id: 8, shipping_address: { name: 'C', address_line1: 'a', city: 'X', state: 'Delhi', pincode: '110001' } },   // already minimal
      { id: 9, shipping_address: { name: 'D', state: 'Delhi', pincode: '110001', gstin: '  ' } },
    ])
    const { DELETE } = await import('@/app/api/account/delete/route')
    await DELETE(req())
    const patches = addrPatches()
    expect(patches.map(p => p[1])).toEqual(['/rest/v1/orders?id=eq.7', '/rest/v1/orders?id=eq.9'])
    expect((patches[0][2] as { shipping_address: object }).shipping_address).toEqual({ name: 'B', city: 'X', state: 'Delhi', pincode: '110001' })
    expect((patches[1][2] as { shipping_address: object }).shipping_address).not.toHaveProperty('gstin')
  })

  it('an address-minimisation failure is fatal: customer stays linked and the auth user is NOT deleted', async () => {
    withOrders([{ id: 7, shipping_address: FULL_ADDR }])
    const base = mocks.sbAdmin.getMockImplementation()!
    mocks.sbAdmin.mockImplementation(async (m: string, path: string, b?: unknown, pref?: string) => {
      if (m === 'PATCH' && path === '/rest/v1/orders?id=eq.7') throw { status: 500, message: 'boom' }
      return base(m, path, b, pref)
    })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { DELETE } = await import('@/app/api/account/delete/route')
    expect((await DELETE(req())).status).toBe(500)
    expect(calls().some(([m, p]) => m === 'PATCH' && p.startsWith('/rest/v1/customers?id='))).toBe(false)
    expect(urls().some(u => u.includes('/auth/v1/admin/users/'))).toBe(false)
    err.mockRestore()
  })

  it('says what is retained and for how long in the response and the e-mail', async () => {
    const { DELETE } = await import('@/app/api/account/delete/route')
    const res = await DELETE(req())
    expect((await res.json()).message).toMatch(/retained.*up to 6 years.*GST law/i)
    const mail = fetchMock.mock.calls.find(([u]) => String(u).includes('api.resend.com'))!
    const html = JSON.parse(mail[1].body).html as string
    expect(html).toMatch(/up to 6 years/); expect(html).toMatch(/not<\/strong> kept on these orders/); expect(html).toMatch(/anonymously/)
  })

  it('stores a hashed IP (never the raw address) in the audit row', async () => {
    const { DELETE } = await import('@/app/api/account/delete/route')
    await DELETE(req())
    const audit = calls().find(([m, p]) => m === 'POST' && p === '/rest/v1/event_logs')![2] as { metadata: Record<string, unknown> }
    expect(audit.metadata).not.toHaveProperty('ip')
    expect(String(audit.metadata.ip_hash)).toMatch(/^[0-9a-f]{16}$/)
    expect(JSON.stringify(audit)).not.toContain('203.0.113.7')
  })

  it('sends the confirmation e-mail only AFTER the auth user was deleted', async () => {
    const { DELETE } = await import('@/app/api/account/delete/route')
    await DELETE(req())
    const order = urls().map(u => (u.includes('/auth/v1/admin/users/') ? 'auth' : u.includes('api.resend.com') ? 'mail' : ''))
    expect(order.indexOf('auth')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('mail')).toBeGreaterThan(order.indexOf('auth'))
  })

  it('sends NO "deleted" e-mail and returns 500 when the auth deletion fails', async () => {
    authDeleteStatus = 500
    const { DELETE } = await import('@/app/api/account/delete/route')
    const res = await DELETE(req())
    expect(res.status).toBe(500)
    expect(urls().some(u => u.includes('api.resend.com'))).toBe(false)
  })

  it('a failing audit insert does not block the erasure but is logged', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.sbAdmin.mockImplementation(async (m: string, path: string) => {
      if (path.startsWith('/rest/v1/customers?auth_user_id=')) return [{ id: 42 }]
      if (path === '/rest/v1/event_logs') throw { status: 500, message: 'x' }
      if (m === 'PATCH' && path.startsWith('/rest/v1/customers?id=')) return [{ id: 42, auth_user_id: null }]
      return []
    })
    const { DELETE } = await import('@/app/api/account/delete/route')
    const res = await DELETE(req())
    expect(res.status).toBe(200)
    expect(err.mock.calls.some(c => String(c[0]).includes('AUDIT ROW NOT WRITTEN'))).toBe(true)
    err.mockRestore()
  })
})
