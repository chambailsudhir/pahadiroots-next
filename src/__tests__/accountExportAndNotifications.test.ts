/**
 * data-export: fails (5xx) instead of exporting empty data, counts the quota only on success, whitelist + completeness.
 * notifications: shared per-user limiter.
 * sanitize.hasUnsafeTextChars.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { hasUnsafeTextChars } from '@/lib/server/sanitize'

const mocks = vi.hoisted(() => ({
  sbAuth: vi.fn(), sbAdmin: vi.fn(), getToken: vi.fn(), tryRefresh: vi.fn(), syncCustomerProfile: vi.fn(),
  checkRateLimit: vi.fn(), checkRateLimitShared: vi.fn(), releaseRateLimitShared: vi.fn(async () => {}), checkCsrf: vi.fn(),
}))
vi.mock('@/lib/api/serverUtils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    ok:   (d: unknown) => NextResponse.json(d),
    fail: (status: number, msg: string, headers?: Record<string, string>) => NextResponse.json({ error: msg }, { status, headers }),
    sbAuth: mocks.sbAuth, sbAdmin: mocks.sbAdmin, getToken: mocks.getToken, tryRefresh: mocks.tryRefresh,
    syncCustomerProfile: mocks.syncCustomerProfile, checkRateLimit: mocks.checkRateLimit,
    checkRateLimitShared: mocks.checkRateLimitShared, releaseRateLimitShared: mocks.releaseRateLimitShared, checkCsrf: mocks.checkCsrf, applyNewCookies: (r: NextResponse) => r,
  }
})

const calls = () => mocks.sbAdmin.mock.calls as Array<[string, string, unknown?]>
const CUSTOMER = {
  id: 5, first_name: 'Asha', last_name: 'Rana', email: 'a@b.com', phone: '9876543210', address_line1: 'x', address_line2: 'y',
  city: 'c', state: 's', pincode: '171001', gstin: '22AAAAA0000A1Z5', is_business: true, created_at: 't', referral_code: 'ASHA1',
  referred_by: 9, loyalty_points: 10, notif_email_orders: true, notif_whatsapp_orders: true, notif_sms_orders: false, notif_email_marketing: false,
  notes: 'INTERNAL NOTE', tags: ['vip'], is_blocked: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkCsrf.mockReturnValue(null)
  mocks.checkRateLimit.mockReturnValue(true)
  mocks.checkRateLimitShared.mockResolvedValue(true)
  mocks.getToken.mockReturnValue('jwt')
  mocks.tryRefresh.mockResolvedValue(null)
  mocks.sbAuth.mockResolvedValue({ id: 'u1', email: 'a@b.com' })
  mocks.syncCustomerProfile.mockResolvedValue({ id: 5 })
  mocks.sbAdmin.mockImplementation(async (_m: string, path: string) => {
    if (path.startsWith('/rest/v1/customers?auth_user_id=')) return [CUSTOMER]
    if (path.startsWith('/rest/v1/customers?id=eq.9')) return [{ referral_code: 'FRIEND9' }]
    if (path.startsWith('/rest/v1/orders?')) return [{ id: 7, order_number: 'ORD-1', notes: 'leave at gate' }]
    if (path.startsWith('/rest/v1/order_items?')) return [{ order_id: 7, quantity: 2, product_name_snapshot: 'Honey' }]
    return []
  })
})

const exportReq = () => import('@/app/api/account/data-export/route').then(({ GET }) =>
  GET(new NextRequest('https://pahadiroots.com/api/account/data-export', { headers: { 'x-forwarded-for': '1.1.1.1', origin: 'https://pahadiroots.com' } })))

describe('GET /api/account/data-export', () => {
  it('fails with 5xx (no empty 200) and does not consume the quota when a section errors', async () => {
    mocks.sbAdmin.mockImplementation(async (_m: string, path: string) => {
      if (path.startsWith('/rest/v1/customers?auth_user_id=')) return [CUSTOMER]
      if (path.startsWith('/rest/v1/loyalty_transactions')) throw { status: 503, message: 'timeout' }
      return []
    })
    const res = await exportReq()
    expect(res.status).toBe(500)
    // the quota hit reserved up front is refunded, so the failed attempt does not count
    expect(mocks.checkRateLimitShared).toHaveBeenCalledWith('data_export:u1', 3, 24 * 60 * 60_000)
    expect(mocks.releaseRateLimitShared).toHaveBeenCalledWith('data_export:u1')
  })

  it('checks the account quota BEFORE building the export, and answers 429 without doing the export work (Nov 2026 audit)', async () => {
    mocks.checkRateLimitShared.mockImplementation(async (k: string) => k !== 'data_export:u1')
    const res = await exportReq()
    expect(res.status).toBe(429)
    expect(mocks.checkRateLimitShared).toHaveBeenCalledWith('data_export:u1', 3, 24 * 60 * 60_000)
    expect(mocks.sbAdmin).not.toHaveBeenCalled()
    expect(mocks.releaseRateLimitShared).not.toHaveBeenCalled()
  })

  it('a successful export keeps its quota hit (no refund)', async () => {
    const res = await exportReq()
    expect(res.status).toBe(200)
    expect(mocks.releaseRateLimitShared).not.toHaveBeenCalled()
  })

  it('exports the own-data whitelist: gstin, address_line2, items, order notes, referral, consent; never notes/tags/is_blocked', async () => {
    const res = await exportReq()
    expect(res.status).toBe(200)
    const body = JSON.parse(await res.text())
    expect(body.profile).toMatchObject({ gstin: '22AAAAA0000A1Z5', address_line2: 'y', is_business: true })
    expect(body.referral).toEqual({ your_referral_code: 'ASHA1', referred_by_code: 'FRIEND9' })
    expect(body.consent).toMatchObject({ marketing_emails: false })
    expect(body.orders[0].notes).toBe('leave at gate')
    expect(body.orders[0].items).toEqual([{ quantity: 2, product_name_snapshot: 'Honey' }])
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('INTERNAL NOTE')
    expect(raw).not.toContain('vip')
    expect(raw).not.toContain('is_blocked')
    expect(raw).not.toContain('admin_notes')
  })

  // Nov 2026 verification: the live wishlist is customers.wishlist_items (JSON text); the export only read the legacy table.
  it('exports the live wishlist (customers.wishlist_items) merged with legacy wishlist rows, de-duplicated', async () => {
    mocks.sbAdmin.mockImplementation(async (_m: string, path: string) => {
      if (path.startsWith('/rest/v1/customers?auth_user_id=')) return [{ ...CUSTOMER, wishlist_items: '[11,28]' }]
      if (path.startsWith('/rest/v1/wishlist?')) return [{ product_id: 28 }, { product_id: 40 }]
      return []
    })
    const res = await exportReq()
    expect(res.status).toBe(200)
    expect(JSON.parse(await res.text()).wishlist_product_ids).toEqual([11, 28, 40])
  })

  it('a malformed wishlist_items value does not break the export', async () => {
    mocks.sbAdmin.mockImplementation(async (_m: string, path: string) => {
      if (path.startsWith('/rest/v1/customers?auth_user_id=')) return [{ ...CUSTOMER, wishlist_items: 'not json' }]
      return []
    })
    const res = await exportReq()
    expect(res.status).toBe(200)
    expect(JSON.parse(await res.text()).wishlist_product_ids).toEqual([])
  })

  // VERIFY ROUND (L-8): returns.photo_urls holds bare object paths; the export mints 15-minute links at read time.
  // Rows written before the change hold year-long links and are passed through unchanged.
  it('return photos: a stored object path becomes a fresh 15-minute signed link; a legacy full link passes through', async () => {
    const legacy = 'https://example.supabase.co/storage/v1/object/sign/return-evidence/returns/6/1-old.jpg?token=year-long'
    mocks.sbAdmin.mockImplementation(async (_m: string, path: string) => {
      if (path.startsWith('/rest/v1/customers?auth_user_id=')) return [CUSTOMER]
      if (path.startsWith('/rest/v1/orders?')) return [{ id: 7, order_number: 'ORD-1' }]
      if (path.startsWith('/rest/v1/returns?')) return [{ id: 'r1', order_number: 'ORD-1', status: 'requested', photo_urls: ['returns/7/1-a.jpg', legacy] }]
      return []
    })
    const storageFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ signedURL: '/object/sign/return-evidence/returns/7/1-a.jpg?token=fresh' }) }))
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_KEY', 'svc')
    vi.stubGlobal('fetch', storageFetch)
    try {
      const body = JSON.parse(await (await exportReq()).text())
      expect(body.returns[0].photo_urls).toEqual([
        'https://example.supabase.co/storage/v1/object/sign/return-evidence/returns/7/1-a.jpg?token=fresh',
        legacy,
      ])
      expect(storageFetch).toHaveBeenCalledTimes(1)
      const [url, init] = storageFetch.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('https://example.supabase.co/storage/v1/object/sign/return-evidence/returns/7/1-a.jpg')
      expect(JSON.parse(init.body as string)).toEqual({ expiresIn: 15 * 60 })
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs() }
  })

  it('pages past the 1000-row PostgREST cap', async () => {
    let page = 0
    mocks.sbAdmin.mockImplementation(async (_m: string, path: string) => {
      if (path.startsWith('/rest/v1/customers?auth_user_id=')) return [CUSTOMER]
      if (path.startsWith('/rest/v1/orders?')) {
        page++
        return page === 1 ? Array.from({ length: 1000 }, (_, i) => ({ id: i })) : [{ id: 1000 }]
      }
      return []
    })
    const body = JSON.parse(await (await exportReq()).text())
    expect(body.orders).toHaveLength(1001)
  })
})

describe('POST /api/account/notifications', () => {
  const notif = () => import('@/app/api/account/notifications/route').then(({ POST }) =>
    POST(new NextRequest('https://pahadiroots.com/api/account/notifications', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.1.1.1', origin: 'https://pahadiroots.com' },
      body: JSON.stringify({ notif_email_marketing: true }),
    })))

  it('uses the shared limiter keyed by user id', async () => {
    // the per-IP guard (also shared now) passes; the per-user one refuses
    mocks.checkRateLimitShared.mockImplementation(async (k: string) => !k.startsWith('notif_post_user:'))
    const res = await notif()
    expect(res.status).toBe(429)
    expect(mocks.checkRateLimitShared.mock.calls.map(c => c[0])).toContain('notif_post_user:u1')
    expect(calls().some(([m]) => m === 'PATCH')).toBe(false)
  })

  it('still saves when under the limit', async () => {
    expect((await notif()).status).toBe(200)
  })
})

describe('hasUnsafeTextChars', () => {
  it.each(['<img src=x onerror=1', 'a>b', 'a\nb', 'a\u0000b', 'a​b', 'a‮b', 'a\u0085b'])('flags %j', v => {
    expect(hasUnsafeTextChars(v)).toBe(true)
  })
  it.each(['Flat 4, Mall Road', 'D-12/3 (near temple), Shimla', 'Åsa Rana', 'राना'])('allows %j', v => {
    expect(hasUnsafeTextChars(v)).toBe(false)
  })
})

describe('per-IP guards use the shared limiter with a normalised IPv6 key (Nov 2026 audit)', () => {
  it('notifications POST: per-IP key is the /64 and goes through checkRateLimitShared', async () => {
    const { POST } = await import('@/app/api/account/notifications/route')
    await POST(new NextRequest('https://pahadiroots.com/api/account/notifications', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '2001:db8:5:6:1::2', origin: 'https://pahadiroots.com' },
      body: JSON.stringify({ notif_email_marketing: true }),
    }))
    expect(mocks.checkRateLimitShared.mock.calls.map(c => c[0])).toContain('notif_post:2001:db8:5:6::/64')
  })
})
