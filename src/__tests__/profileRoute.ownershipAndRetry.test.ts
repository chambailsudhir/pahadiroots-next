/**
 * POST /api/profile — address id ownership, idempotent retry, atomic replace, phone disclosure, text hygiene, shared limiter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  sbAuth: vi.fn(), sbAdmin: vi.fn(), syncCustomerProfile: vi.fn(),
  getToken: vi.fn(), tryRefresh: vi.fn(), checkRateLimit: vi.fn(), checkRateLimitShared: vi.fn(), checkCsrf: vi.fn(),
}))
vi.mock('@/lib/api/serverUtils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    ok:   (d: unknown) => NextResponse.json(d),
    fail: (status: number, msg: string, headers?: Record<string, string>) => NextResponse.json({ error: msg }, { status, headers }),
    sbAuth: mocks.sbAuth, sbAdmin: mocks.sbAdmin, syncCustomerProfile: mocks.syncCustomerProfile,
    getToken: mocks.getToken, tryRefresh: mocks.tryRefresh, checkRateLimit: mocks.checkRateLimit,
    checkRateLimitShared: mocks.checkRateLimitShared, checkCsrf: mocks.checkCsrf,
    applyNewCookies: (r: NextResponse) => r, toPublicProfile: (p: unknown) => p,
  }
})
import { addressesEtag } from '@/lib/server/addressEtag'

const post = (body: unknown) => import('@/app/api/profile/route').then(({ POST }) =>
  POST(new NextRequest('https://pahadiroots.com/api/profile', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '9.9.9.9', origin: 'https://pahadiroots.com' },
    body: JSON.stringify(body),
  })))

const MINE = '11111111-1111-4111-8111-111111111111'
const THEIRS = '22222222-2222-4222-8222-222222222222'
const stored = { id: MINE, label: 'Home', name: 'Asha', phone: '9876543210', addr: '12 Pahadi Lane', city: 'Shimla', state: 'Himachal Pradesh', pin: '171001' }
const NEW_ADDR = { label: 'Office', name: 'Asha', phone: '9876543210', addr: '5 Mall Road', city: 'Shimla', state: 'Himachal Pradesh', pin: '171001' }

let existing: unknown[] = []
let rpcResult: unknown = true
let rpcError: unknown = null
const calls = () => mocks.sbAdmin.mock.calls as Array<[string, string, unknown?, string?]>

beforeEach(() => {
  vi.clearAllMocks()
  existing = [stored]; rpcResult = true; rpcError = null
  mocks.checkCsrf.mockReturnValue(null)
  mocks.checkRateLimit.mockReturnValue(true)
  mocks.checkRateLimitShared.mockResolvedValue(true)
  mocks.getToken.mockReturnValue('jwt')
  mocks.tryRefresh.mockResolvedValue(null)
  mocks.sbAuth.mockResolvedValue({ id: 'u1', email: 'a@b.com' })
  mocks.syncCustomerProfile.mockResolvedValue({ id: 58 })
  mocks.sbAdmin.mockImplementation(async (m: string, path: string) => {
    if (path.includes('/rpc/replace_saved_addresses')) { if (rpcError) throw rpcError; return rpcResult }
    if (m === 'GET' && path.startsWith('/rest/v1/saved_addresses')) return existing
    return []
  })
})

describe('address id ownership', () => {
  it("replaces an id the caller does not own with a fresh UUID (another customer's row is never overwritten)", async () => {
    rpcError = { status: 404, message: 'PGRST202 Could not find the function' }   // exercise the fallback path
    const res = await post({ saved_addresses: [{ ...NEW_ADDR, id: THEIRS }] })
    expect(res.status).toBe(200)
    const upsert = calls().find(([m, p]) => m === 'POST' && p === '/rest/v1/saved_addresses')!
    const rows = upsert[2] as Array<{ id: string; customer_id: number }>
    expect(rows[0].id).not.toBe(THEIRS)
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/)
    expect(rows[0].customer_id).toBe(58)
    expect(JSON.stringify(calls())).not.toContain(`not.in.(${THEIRS}`)
  })

  it('keeps the caller\'s own ids and replaces a duplicated one', async () => {
    rpcError = { status: 404, message: 'PGRST202' }
    await post({ saved_addresses: [{ ...stored, addr: '14 Pahadi Lane' }, { ...NEW_ADDR, id: MINE }] })
    const rows = calls().find(([m, p]) => m === 'POST' && p === '/rest/v1/saved_addresses')![2] as Array<{ id: string }>
    expect(rows[0].id).toBe(MINE)
    expect(rows[1].id).not.toBe(MINE)
  })
})

describe('lost-update protection', () => {
  it('a retry of an already-applied save returns success, not a false 409', async () => {
    const res = await post({ saved_addresses: [{ ...stored }], saved_addresses_etag: 'stale-etag-from-before-first-attempt' })
    expect(res.status).toBe(200)
    expect(calls().some(([m]) => m === 'POST' || m === 'DELETE')).toBe(false)
  })

  it('a real concurrent change is still a 409', async () => {
    const res = await post({ saved_addresses: [{ ...stored }, NEW_ADDR], saved_addresses_etag: 'stale' })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('addresses_changed')
  })

  it('uses the atomic RPC with the list it read, and maps its conflict to 409', async () => {
    const etag = addressesEtag([stored])
    let res = await post({ saved_addresses: [{ ...stored }, NEW_ADDR], saved_addresses_etag: etag })
    expect(res.status).toBe(200)
    const rpc = calls().find(([, p]) => p.includes('/rpc/replace_saved_addresses'))!
    expect(rpc[2]).toMatchObject({ p_customer_id: 58, p_expected: [stored] })
    expect(calls().some(([m, p]) => m === 'POST' && p === '/rest/v1/saved_addresses')).toBe(false)

    rpcResult = false
    res = await post({ saved_addresses: [{ ...stored }, NEW_ADDR], saved_addresses_etag: etag })
    expect(res.status).toBe(409)
  })

  it('does not treat a failed read of the stored list as "empty"', async () => {
    mocks.sbAdmin.mockImplementation(async (m: string, path: string) => {
      if (m === 'GET' && path.startsWith('/rest/v1/saved_addresses')) throw { status: 500, message: 'db' }
      return []
    })
    const res = await post({ saved_addresses: [NEW_ADDR] })
    expect(res.status).toBe(500)
    expect(calls().some(([m]) => m === 'POST' || m === 'DELETE')).toBe(false)
  })
})

describe('phone disclosure + limits', () => {
  it('answers a generic 400 (no "already linked to another account") on a unique-phone clash', async () => {
    mocks.sbAdmin.mockImplementation(async (m: string, path: string) => {
      if (m === 'PATCH') throw { status: 409, message: 'duplicate key value violates unique constraint "customers_normalized_phone_key" phone' }
      return []
    })
    const res = await post({ phone: '9876543210' })
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).not.toMatch(/another account|already/i)
  })

  it('rate-limits phone changes with the shared limiter (per user and per IP)', async () => {
    mocks.checkRateLimitShared.mockImplementation(async (k: string) => !k.startsWith('profile_phone_user:'))
    const res = await post({ phone: '9876543210' })
    expect(res.status).toBe(429)
    expect(calls().some(([m]) => m === 'PATCH')).toBe(false)
    const keys = mocks.checkRateLimitShared.mock.calls.map(c => c[0])
    expect(keys).toContain('profile_post_user:u1')
  })

  it('applies the shared per-user limit to every write', async () => {
    mocks.checkRateLimitShared.mockResolvedValue(false)
    const res = await post({ first_name: 'Asha' })
    expect(res.status).toBe(429)
  })
})

describe('text hygiene', () => {
  it.each([
    ['unterminated tag in first_name', { first_name: '<img src=x onerror=alert(1)' }],
    ['newline in city',                { city: 'Shi\nmla' }],
    ['zero-width char in address',     { address_line1: 'Lane​ 12' }],
  ])('rejects %s', async (_n, body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(calls().some(([m]) => m === 'PATCH')).toBe(false)
  })

  it('rejects markup / control characters in saved-address fields', async () => {
    for (const bad of [{ name: '<img src=x onerror=1' }, { addr: '12 Lane\r\nX-Evil: 1' }, { city: 'Shi‮mla' }]) {
      const res = await post({ saved_addresses: [{ ...NEW_ADDR, ...bad }] })
      expect(res.status).toBe(400)
    }
  })
})
