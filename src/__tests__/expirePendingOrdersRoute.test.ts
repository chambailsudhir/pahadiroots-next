/** I1 — cron route auth + wiring. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ sweep: vi.fn(), rpc: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', () => ({ supabase: {}, getServiceClient: vi.fn(() => ({ rpc: (...a: unknown[]) => h.rpc(...a) })) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, captureError: vi.fn() }))
const rr = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/lib/server/reviewRequests', () => ({ sendReviewRequests: (...a: unknown[]) => rr.send(...a) }))
vi.mock('@/lib/server/pendingOrders', () => ({ expireStalePendingOrders: (...a: unknown[]) => h.sweep(...a) }))

const call = async (auth?: string) => {
  const { GET } = await import('@/app/api/v1/cron/expire-pending-orders/route')
  return GET(new Request('http://localhost/api/v1/cron/expire-pending-orders', { headers: auth ? { authorization: auth } : {} }) as any)
}

beforeEach(() => { rr.send.mockReset(); rr.send.mockResolvedValue({ sent: 0 }); h.sweep.mockReset(); h.rpc.mockReset(); h.rpc.mockResolvedValue({ data: 0, error: null }); vi.stubEnv('CRON_SECRET', 'sekret') })
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

  it('also releases earned referral coins, and a failure there never masks the stock sweep', async () => {
    h.sweep.mockResolvedValue({ scanned: 0, expired: 0, recovered: 0, skipped: 0, errors: 0 })
    h.rpc.mockImplementation(async (name: string) => name === 'process_referral_rewards' ? { data: { rewarded: 2, rejected: 1, waiting: 3 }, error: null } : { data: 0, error: null })
    const ok = await (await call('Bearer sekret')).json()
    expect(ok.referralRewards).toEqual({ rewarded: 2, rejected: 1, waiting: 3 })
    expect(h.rpc).toHaveBeenCalledWith('process_referral_rewards', { p_limit: 50 })

    h.rpc.mockImplementation(async (name: string) => name === 'process_referral_rewards' ? { data: null, error: { message: 'boom' } } : { data: 0, error: null })
    const res = await call('Bearer sekret')
    expect(res.status).toBe(200)
    expect((await res.json()).referralRewards).toBeNull()
  })

  // Owner decision (Nov 2026): coins unused for 12 months expire (db_migration_v37), as a daily, non-fatal step.
  it('expires year-old unused coins daily and reports how many customers were affected; a failure never masks the sweep', async () => {
    h.sweep.mockResolvedValue({ scanned: 0, expired: 0, recovered: 0, skipped: 0, errors: 0 })
    h.rpc.mockImplementation(async (name: string) => name === 'expire_old_loyalty_points' ? { data: 3, error: null } : { data: 0, error: null })
    const ok = await (await call('Bearer sekret')).json()
    expect(h.rpc).toHaveBeenCalledWith('expire_old_loyalty_points', { p_limit: 200 })
    expect(ok.coinsExpiredCustomers).toBe(3)
    h.rpc.mockImplementation(async (name: string) => name === 'expire_old_loyalty_points' ? { data: null, error: { message: 'boom' } } : { data: 0, error: null })
    expect((await call('Bearer sekret')).status).toBe(200)
  })

  it('sends review requests as a non-fatal step and reports the count', async () => {
    h.sweep.mockResolvedValue({ scanned: 0, expired: 0, recovered: 0, skipped: 0, errors: 0 })
    rr.send.mockResolvedValue({ enabled: true, scanned: 5, sent: 4, skipped: 1, errors: 0 })
    const json = await (await call('Bearer sekret')).json()
    expect(json.reviewRequests).toBe(4)

    rr.send.mockRejectedValue(new Error('boom'))
    const res = await call('Bearer sekret')
    expect(res.status).toBe(200)
    expect((await res.json()).reviewRequests).toBe(0)
  })
})
