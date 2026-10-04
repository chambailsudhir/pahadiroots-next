/** C1 — POST /api/v1/cart/validate */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ validate: vi.fn(), rate: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', () => ({ supabase: {}, getServiceClient: vi.fn(() => ({})) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, captureError: vi.fn() }))
vi.mock('@/lib/api/rateLimitKv', () => ({ checkRateLimitKv: (...a: unknown[]) => h.rate(...a) }))
vi.mock('@/lib/server/cartValidation', () => ({ validateCartLines: (...a: unknown[]) => h.validate(...a) }))

const post = async (body: unknown, raw = false) => {
  const { POST } = await import('@/app/api/v1/cart/validate/route')
  return POST(new Request('http://localhost/api/v1/cart/validate', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: raw ? (body as string) : JSON.stringify(body),
  }) as any)
}
const ok = { items: [{ productId: '1', variantId: '11', qty: 2 }] }

beforeEach(() => { h.validate.mockReset(); h.rate.mockReset().mockResolvedValue(true) })

describe('POST /api/v1/cart/validate', () => {
  it('returns the live lines, uncached', async () => {
    h.validate.mockResolvedValue([{ productId: '1', variantId: '11', status: 'ok', name: 'X', price: 5, mrp: 6, available: 9 }])
    const res = await post(ok)
    expect(res.status).toBe(200)
    expect((await res.json()).lines[0]).toMatchObject({ variantId: '11', status: 'ok' })
    expect(res.headers.get('cache-control')).toMatch(/no-store/)
    expect(h.validate).toHaveBeenCalledWith(expect.anything(), ok.items)
  })
  it('rate limited → 429', async () => {
    h.rate.mockResolvedValue(false)
    expect((await post(ok)).status).toBe(429)
    expect(h.validate).not.toHaveBeenCalled()
  })
  it.each([
    ['not JSON', 'nope', true],
    ['no items', { items: [] }, false],
    ['bad id (filter injection)', { items: [{ productId: '1', variantId: '1),or=(id.gt.0', qty: 1 }] }, false],
    ['qty 0', { items: [{ productId: '1', variantId: '11', qty: 0 }] }, false],
    ['too many lines', { items: Array.from({ length: 31 }, (_, i) => ({ productId: String(i + 1), variantId: String(i + 100), qty: 1 })) }, false],
  ])('%s → 400, never reaches the database', async (_l, body, raw) => {
    expect((await post(body, raw as boolean)).status).toBe(400)
    expect(h.validate).not.toHaveBeenCalled()
  })
  it('lookup failure → 500 with a generic message (no internals)', async () => {
    h.validate.mockRejectedValue(new Error('relation product_variants does not exist'))
    const res = await post(ok)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toMatch(/relation/)
  })
})
