/**
 * couponHintsRoute.test.ts
 *
 * AUDIT S1-010 — GET /api/v1/coupon-hints published every active coupon
 * ordered by value, including other subscribers' single-use personal
 * `WELCOME5-<hash>` codes minted by the newsletter `subscribe` action
 * (max_uses=1, description "Newsletter welcome…"). Anyone could read and burn
 * another customer's one-time code.
 *
 * The route must (a) exclude single-use / welcome codes in the PostgREST
 * query itself and (b) re-apply the same filter in JS (belt and suspenders
 * for the last-good fallback and any RLS/column drift), while (c) still
 * returning only { code, label } per hint.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const fetchMock = vi.fn()

beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  vi.stubGlobal('fetch', fetchMock)
})

const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString()

// What the DB would return if the SQL-side filter were missing/bypassed —
// already in the route's `order=value.desc` order (the route does not re-sort).
const ROWS = [
  // a staff-issued one-off goodwill code — single use, must never appear
  { code: 'SORRY-ASHA',      type: 'flat',    value: 200, min_order: null, expires_at: null,   max_uses: 1,    description: 'Goodwill for order PR123' },
  // genuinely public, multi-use codes
  { code: 'FLAT100',         type: 'flat',    value: 100, min_order: 999,  expires_at: null,   max_uses: 500,  description: null },
  { code: 'FESTIVE20',       type: 'percent', value: 20,  min_order: 1499, expires_at: FUTURE, max_uses: 1000, description: 'Diwali' },
  { code: 'MONSOON15',       type: 'percent', value: 15,  min_order: null, expires_at: FUTURE, max_uses: 50,   description: '' },
  { code: 'FIRST10',         type: 'percent', value: 10,  min_order: 499,  expires_at: FUTURE, max_uses: null, description: 'Launch offer' },
  // other subscribers' personal single-use welcome codes — must never appear
  { code: 'WELCOME5-A1B2C3', type: 'percent', value: 5,   min_order: null, expires_at: FUTURE, max_uses: 1,    description: 'Newsletter welcome discount (5% off, first order)' },
  { code: 'welcome5-d4e5f6', type: 'percent', value: 5,   min_order: null, expires_at: FUTURE, max_uses: 1,    description: 'Newsletter welcome discount (5% off, first order)' },
  // renamed welcome code (prefix lost) — description still marks it personal
  { code: 'HELLO-9F9F9F',    type: 'percent', value: 5,   min_order: null, expires_at: FUTURE, max_uses: 3,    description: 'Newsletter welcome discount (5% off, first order)' },
]

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ROWS })
})

describe('GET /api/v1/coupon-hints (AUDIT S1-010)', () => {
  it('never lists single-use (max_uses <= 1) or newsletter-welcome codes, even if the DB returns them', async () => {
    const { GET } = await import('@/app/api/v1/coupon-hints/route')
    const res  = await GET()
    const body = await res.json() as { hints: { code: string }[] }
    const codes = body.hints.map(h => h.code)

    expect(codes).not.toContain('WELCOME5-A1B2C3')
    expect(codes).not.toContain('welcome5-d4e5f6')
    expect(codes).not.toContain('SORRY-ASHA')
    expect(codes).not.toContain('HELLO-9F9F9F')
    for (const code of codes) expect(code.toUpperCase().startsWith('WELCOME5-')).toBe(false)
  })

  it('still returns up to 3 public multi-use codes, highest value first', async () => {
    const { GET } = await import('@/app/api/v1/coupon-hints/route')
    const body = await (await GET()).json() as { hints: { code: string; label: string }[] }
    // SORRY-ASHA (single-use) is skipped even though it has the highest value.
    expect(body.hints.map(h => h.code)).toEqual(['FLAT100', 'FESTIVE20', 'MONSOON15'])
    expect(body.hints[0].label).toBe('₹100 off on ₹999+')
    expect(body.hints[1].label).toBe('20% off on ₹1499+')
  })

  it('exposes only { code, label } — max_uses / description / expires_at never leave the server', async () => {
    const { GET } = await import('@/app/api/v1/coupon-hints/route')
    const body = await (await GET()).json() as { hints: Record<string, unknown>[] }
    expect(body.hints.length).toBeGreaterThan(0)
    for (const h of body.hints) expect(Object.keys(h).sort()).toEqual(['code', 'label'])
  })

  it('excludes single-use and WELCOME5-* codes in the PostgREST query itself (not only in JS)', async () => {
    const { GET } = await import('@/app/api/v1/coupon-hints/route')
    await GET()
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('is_active=eq.true')
    expect(url).toContain('or(max_uses.is.null,max_uses.gt.1)')
    expect(url).toContain('code=not.ilike.WELCOME5-*')
    // expiry filter preserved
    expect(url).toMatch(/or\(expires_at\.is\.null,expires_at\.gte\./)
    // the filter columns are fetched so the JS guard can run
    expect(url).toMatch(/select=[^&]*max_uses/)
  })

  it('still uses the anon key (service key must not be used for a public GET)', async () => {
    const { GET } = await import('@/app/api/v1/coupon-hints/route')
    await GET()
    const init = fetchMock.mock.calls[0][1]
    expect(init.headers.apikey).toBe('anon')
  })
})
