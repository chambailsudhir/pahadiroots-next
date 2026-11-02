import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/api/rateLimitKv', () => ({ checkRateLimitKvStrict: vi.fn() }))
import { runBackgroundSweepsIfDue, SWEEP_PATHS, SWEEP_INTERVAL_SEC } from '@/lib/server/backgroundSweeps'

const ok = (..._a: unknown[]) => Promise.resolve({ ok: true, status: 200 } as Response)

describe('runBackgroundSweepsIfDue (OPS-001)', () => {
  it('when due: calls both secured sweep endpoints with the server-side bearer secret', async () => {
    const fetchImpl = vi.fn(ok)
    const gate = vi.fn().mockResolvedValue('allowed')
    const ran = await runBackgroundSweepsIfDue('https://www.pahadiroots.com', { fetchImpl: fetchImpl as unknown as typeof fetch, gate, env: { CRON_SECRET: 's3cret' } })
    expect(ran).toBe(true)
    expect(gate).toHaveBeenCalledWith('mw:sweep:background', 1, SWEEP_INTERVAL_SEC)
    expect(fetchImpl.mock.calls.map(c => c[0] as string)).toEqual(SWEEP_PATHS.map(p => 'https://www.pahadiroots.com' + p))
    for (const c of fetchImpl.mock.calls) expect((c[1] as unknown as RequestInit).headers).toEqual({ Authorization: 'Bearer s3cret' })
  })
  it('throttled (another order already triggered one in this window): does nothing', async () => {
    const fetchImpl = vi.fn(ok)
    expect(await runBackgroundSweepsIfDue('https://x.test', { fetchImpl: fetchImpl as unknown as typeof fetch, gate: async () => 'blocked', env: { CRON_SECRET: 's' } })).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('limiter unavailable: skips (never sweeps on every request)', async () => {
    const fetchImpl = vi.fn(ok)
    expect(await runBackgroundSweepsIfDue('https://x.test', { fetchImpl: fetchImpl as unknown as typeof fetch, gate: async () => 'unavailable', env: { CRON_SECRET: 's' } })).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('no CRON_SECRET or a bad origin: does nothing and does not even touch the limiter', async () => {
    const gate = vi.fn()
    expect(await runBackgroundSweepsIfDue('https://x.test', { gate, env: {} })).toBe(false)
    expect(await runBackgroundSweepsIfDue('not-a-url', { gate, env: { CRON_SECRET: 's' } })).toBe(false)
    expect(gate).not.toHaveBeenCalled()
  })
  it('never throws: a failing endpoint is logged and the other still runs', async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error('boom')).mockImplementation(ok)
    const ran = await runBackgroundSweepsIfDue('https://x.test', { fetchImpl: fetchImpl as unknown as typeof fetch, gate: async () => 'allowed', env: { CRON_SECRET: 's' } })
    expect(ran).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
  it('never throws even if the limiter itself throws', async () => {
    expect(await runBackgroundSweepsIfDue('https://x.test', { gate: async () => { throw new Error('kv down') }, env: { CRON_SECRET: 's' } })).toBe(false)
  })
})
