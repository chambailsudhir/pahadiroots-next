/**
 * profileRoute.validation.test.ts
 *
 * AUDIT ACC-039 (live evidence, test user A):
 *  • the API accepted a blank first name, "5123456789" as a mobile, "Atlantis" as a state;
 *  • the account UI sent the pincode as `postal_code` while the customers column / allow-list is
 *    `pincode`, so "Save Address" silently dropped it (customers.pincode stayed NULL);
 *  • saved-address rows had no length / tag / pincode / mobile checks.
 * Privileged columns (loyalty_points, is_blocked, notes, …) must keep being ignored.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  sbAuth: vi.fn(), sbAdmin: vi.fn(), syncCustomerProfile: vi.fn(),
  getToken: vi.fn(), tryRefresh: vi.fn(), checkRateLimit: vi.fn(), checkCsrf: vi.fn(),
}))
vi.mock('@/lib/api/serverUtils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    ok:   (d: unknown) => NextResponse.json(d),
    fail: (status: number, msg: string, headers?: Record<string, string>) => NextResponse.json({ error: msg }, { status, headers }),
    sbAuth: mocks.sbAuth, sbAdmin: mocks.sbAdmin, syncCustomerProfile: mocks.syncCustomerProfile,
    getToken: mocks.getToken, tryRefresh: mocks.tryRefresh, checkRateLimit: mocks.checkRateLimit, checkCsrf: mocks.checkCsrf,
    applyNewCookies: (r: NextResponse) => r, toPublicProfile: (p: unknown) => p,
  }
})

const post = (body: unknown) => import('@/app/api/profile/route').then(({ POST }) =>
  POST(new NextRequest('https://pahadiroots.com/api/profile', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '9.9.9.9', origin: 'https://pahadiroots.com' },
    body: JSON.stringify(body),
  })))

const patchBody = (): Record<string, unknown> | undefined =>
  (mocks.sbAdmin.mock.calls.find(([m, p]) => m === 'PATCH' && String(p).startsWith('/rest/v1/customers?id=')) as [string, string, Record<string, unknown>] | undefined)?.[2]

const GOOD_ADDR = { label: 'Home', name: 'Asha', phone: '9876543210', addr: '12 Pahadi Lane', city: 'Shimla', state: 'Himachal Pradesh', pin: '171001' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkCsrf.mockReturnValue(null)
  mocks.checkRateLimit.mockReturnValue(true)
  mocks.getToken.mockReturnValue('jwt')
  mocks.tryRefresh.mockResolvedValue(null)
  mocks.sbAuth.mockResolvedValue({ id: 'u1', email: 'a@b.com' })
  mocks.syncCustomerProfile.mockResolvedValue({ id: 58 })
  mocks.sbAdmin.mockResolvedValue([])
})

describe('POST /api/profile — scalar fields (ACC-039)', () => {
  it('saves the pincode when the client sends the legacy `postal_code` key (mapped to the real column)', async () => {
    const res = await post({ address_line1: '12 Pahadi Lane', city: 'Shimla', state: 'Himachal Pradesh', postal_code: '171001' })
    expect(res.status).toBe(200)
    expect(patchBody()).toMatchObject({ pincode: '171001', city: 'Shimla', state: 'Himachal Pradesh' })
    expect(patchBody()).not.toHaveProperty('postal_code')
  })

  it.each([
    ['blank first name',        { first_name: '' },           /first name is required/i],
    ['phone not starting 6-9',  { phone: '5123456789' },      /valid 10-digit mobile/i],
    ['phone too short',         { phone: '12345' },           /valid 10-digit mobile/i],
    ['phone with letters',      { phone: 'abcdefghij' },      /valid 10-digit mobile/i],
    ['state that does not exist', { state: 'Atlantis' },      /valid state/i],
    ['non-numeric pincode',     { pincode: 'abcdef' },        /6-digit pincode/i],
    ['5-digit pincode',         { pincode: '17100' },         /6-digit pincode/i],
  ])('400s for %s and writes nothing', async (_label, body, msg) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(msg)
    expect(patchBody()).toBeUndefined()
  })

  it('normalises +91 / spaces to bare 10 digits and lets the customer CLEAR optional fields', async () => {
    const res = await post({ phone: '+91 98765-43210', state: '', pincode: '' })
    expect(res.status).toBe(200)
    expect(patchBody()).toMatchObject({ phone: '9876543210', state: null, pincode: null })
  })

  it('still ignores privileged columns (mass-assignment stays closed)', async () => {
    await post({ first_name: 'Asha', loyalty_points: 99999, is_blocked: false, notes: 'x', tags: ['x'], referral_code: 'HACK', auth_user_id: 'x', id: 1, email: 'evil@x.com' })
    const body = patchBody()!
    for (const k of ['loyalty_points', 'is_blocked', 'notes', 'tags', 'referral_code', 'auth_user_id', 'id', 'email']) expect(body).not.toHaveProperty(k)
  })
})

describe('POST /api/profile — duplicate mobile number (live verification)', () => {
  it('answers 409 with a clear message when the number already belongs to another account (unique normalized_phone)', async () => {
    mocks.sbAdmin.mockImplementation(async (m: string, p: string) => {
      if (m === 'PATCH' && p.startsWith('/rest/v1/customers?id=')) throw { status: 409, message: '{"code":"23505","message":"duplicate key value violates unique constraint \\"customers_normalized_phone_key\\""}' }
      return []
    })
    const res = await post({ phone: '9876543210' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already linked to another account/i)
  })
})

describe('POST /api/profile — saved addresses (ACC-039)', () => {
  const upsert = () => mocks.sbAdmin.mock.calls.find(([m, p]) => m === 'POST' && p === '/rest/v1/saved_addresses') as [string, string, Array<Record<string, unknown>>] | undefined

  it('accepts a complete address and stores sanitised, normalised values', async () => {
    const res = await post({ saved_addresses: JSON.stringify([{ ...GOOD_ADDR, name: '<b>Asha</b>', phone: '+91 98765 43210' }]) })
    expect(res.status).toBe(200)
    expect(upsert()![2][0]).toMatchObject({ customer_id: 58, name: 'Asha', phone: '9876543210', pin: '171001', state: 'Himachal Pradesh' })
  })

  it.each([
    ['missing pincode',     { pin: '' },                 /6-digit pincode/i],
    ['invalid pincode',     { pin: '12' },               /6-digit pincode/i],
    ['missing phone',       { phone: '' },               /valid 10-digit mobile/i],
    ['phone starting 5',    { phone: '5123456789' },     /valid 10-digit mobile/i],
    ['unknown state',       { state: 'Narnia' },         /valid state/i],
    ['street too short',    { addr: 'ab' },              /street address/i],
    ['street over 200',     { addr: 'z'.repeat(201) },   /street address/i],
    ['unknown label',       { label: 'Secret lair' },    /label/i],
  ])('400s for a NEW address with %s', async (_l, over, msg) => {
    const res = await post({ saved_addresses: JSON.stringify([{ ...GOOD_ADDR, ...over }]) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(msg)
    expect(upsert()).toBeUndefined()
  })

  it('keeps LEGACY rows (already in the DB, saved before phone/pincode existed) editable without forcing the new fields', async () => {
    const LEGACY_ID = '11111111-1111-1111-1111-111111111111'
    mocks.sbAdmin.mockImplementation(async (m: string, p: string) =>
      m === 'GET' && p.startsWith('/rest/v1/saved_addresses?customer_id=eq.58') ? [{ id: LEGACY_ID }] : [])
    const res = await post({ saved_addresses: JSON.stringify([{ id: LEGACY_ID, label: 'Home', addr: 'Old house', city: 'Shimla', state: 'Himachal Pradesh', pin: '', phone: '' }]) })
    expect(res.status).toBe(200)
    expect(upsert()![2][0]).toMatchObject({ id: LEGACY_ID, pin: null, phone: null })
  })

  it('refuses more than 10 addresses and non-UUID ids never reach the SQL filter', async () => {
    const many = Array.from({ length: 11 }, () => GOOD_ADDR)
    expect((await post({ saved_addresses: JSON.stringify(many) })).status).toBe(400)

    mocks.sbAdmin.mockResolvedValue([])
    await post({ saved_addresses: JSON.stringify([{ ...GOOD_ADDR, id: '1),(select 1' }]) })
    const id = String(upsert()![2][0].id)
    expect(id).not.toContain('select')                                   // the injected value never reaches the SQL filter
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)   // the server minted a clean uuid
  })
})

// ── lost-update protection for the saved-address list (ACC-043b) ───────────────────────────────────────────
import { addressesEtag } from '@/lib/server/addressEtag'

describe('POST /api/profile — saved-address version check (two tabs must not overwrite each other)', () => {
  const stored = [{ id: '11111111-1111-1111-1111-111111111111', label: 'Home', name: 'A', phone: '9876543210', addr: '12 Pahadi Lane', city: 'Shimla', state: 'Himachal Pradesh', pin: '171001' }]
  const upserts = () => mocks.sbAdmin.mock.calls.filter(([m, p]) => m === 'POST' && p === '/rest/v1/saved_addresses')
  const wireStored = (rows: unknown[]) => mocks.sbAdmin.mockImplementation(async (m: string, p: string) =>
    m === 'GET' && p.startsWith('/rest/v1/saved_addresses?customer_id=eq.58') ? rows : [])

  it('409 `addresses_changed` and NO write when the stored list differs from the version the client loaded', async () => {
    wireStored(stored)
    const res = await post({ saved_addresses: JSON.stringify([GOOD_ADDR]), saved_addresses_etag: 'stale-version' })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('addresses_changed')
    expect(upserts()).toHaveLength(0)
    expect(mocks.sbAdmin.mock.calls.some(([m]) => m === 'DELETE')).toBe(false)
  })

  it('also protects the "delete everything" save', async () => {
    wireStored(stored)
    const res = await post({ saved_addresses: '[]', saved_addresses_etag: 'stale-version' })
    expect(res.status).toBe(409)
    expect(mocks.sbAdmin.mock.calls.some(([m]) => m === 'DELETE')).toBe(false)
  })

  it('saves when the version matches, and hands back the NEW version', async () => {
    wireStored(stored)
    const res = await post({ saved_addresses: JSON.stringify([...stored, GOOD_ADDR]), saved_addresses_etag: addressesEtag(stored) })
    expect(res.status).toBe(200)
    expect(upserts()).toHaveLength(1)
    expect(typeof (await res.json()).saved_addresses_etag).toBe('string')
  })

  it('older clients that send no version keep working (last write wins, as before)', async () => {
    wireStored(stored)
    expect((await post({ saved_addresses: JSON.stringify([GOOD_ADDR]) })).status).toBe(200)
  })

  it('the fingerprint changes when ANY field of ANY address changes, and ignores row order', () => {
    const a = addressesEtag(stored)
    expect(addressesEtag([{ ...stored[0], city: 'Manali' }])).not.toBe(a)
    expect(addressesEtag([{ ...stored[0], phone: '9000000001' }])).not.toBe(a)
    expect(addressesEtag([])).not.toBe(a)
    const two = [stored[0], { ...stored[0], id: '22222222-2222-2222-2222-222222222222' }]
    expect(addressesEtag(two)).toBe(addressesEtag([...two].reverse()))
  })
})

// ── live-verification find: an address row WITHOUT an id was inserted and then deleted by the cleanup ──────────────
describe('POST /api/profile — id-less address rows are stored, not wiped', () => {
  it('mints an id, upserts the row and never runs the "delete everything" cleanup', async () => {
    mocks.sbAdmin.mockImplementation(async () => [])
    const res = await post({ saved_addresses: JSON.stringify([GOOD_ADDR]) })   // GOOD_ADDR has no id
    expect(res.status).toBe(200)
    const upsert = mocks.sbAdmin.mock.calls.find(([m, p]) => m === 'POST' && p === '/rest/v1/saved_addresses') as [string, string, Array<Record<string, unknown>>]
    expect(typeof upsert[2][0].id).toBe('string')
    const deletes = mocks.sbAdmin.mock.calls.filter(([m]) => m === 'DELETE').map(c => String(c[1]))
    // the only cleanup allowed is "everything EXCEPT the ids just written"
    expect(deletes.every(u => u.includes('id=not.in.('))).toBe(true)
    expect(deletes.some(u => u.endsWith(`customer_id=eq.58`))).toBe(false)
  })
})
