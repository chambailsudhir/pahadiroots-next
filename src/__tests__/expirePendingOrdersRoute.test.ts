/** I1 — cron route auth + wiring. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ sweep: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', () => ({ supabase: {}, getServiceClient: vi.fn(() => ({})) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, captureError: vi.fn() }))
vi.mock('@/lib/server/pendingOrders', () => ({ expireStalePendingOrders: (...a: unknown[]) => h.sweep(...a) }))

const call = async (auth?: string) => {
  const { GET } = await import('@/app/api/v1/cron/expire-pending-orders/route')
  return GET(new Request('http://localhost/api/v1/cron/expire-pending-orders', { headers: auth ? { authorization: auth } : {} }) as any)
}

beforeEach(() => { h.sweep.mockReset(); vi.stubEnv('CRON_SECRET', 'sekret') })
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/v1/cron/expire-pending-orders', () => {
  it('fails CLOSED (500) when CRON_SECRET is not configured, and never sweeps', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const res = await call('Bearer anything')
    expect(res.status).toBe(500)
    expect(h.sweep).not.toHaveBeenCalled()
  })
  it.each([undefined, 'Bearer wrong', 'sekret', 'Bearer sekre'])('rejects bad auth (%s) with 401, no sweep', async (auth) => {
    const res = await call(auth)
    expect(res.status).toBe(401)
    expect(h.sweep).not.toHaveBeenCalled()
  })
  it('valid auth → runs the sweep and returns its stats', async () => {
    h.sweep.mockResolvedValue({ scanned: 3, expired: 2, recovered: 1, skipped: 0, errors: 0 })
    const res  = await call('Bearer sekret')
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, scanned: 3, expired: 2, recovered: 1 })
  })
  it('returns 500 when any order errored, so the failure shows in the cron history', async () => {
    h.sweep.mockResolvedValue({ scanned: 1, expired: 0, recovered: 0, skipped: 0, errors: 1 })
    const res = await call('Bearer sekret')
    expect(res.status).toBe(500)
  })
  it('returns 500 when the sweep throws', async () => {
    h.sweep.mockRejectedValue(new Error('boom'))
    expect((await call('Bearer sekret')).status).toBe(500)
  })
})
