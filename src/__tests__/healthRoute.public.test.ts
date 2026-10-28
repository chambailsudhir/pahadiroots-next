/** AUDIT S2-021: /api/health is minimal in public; details need the CRON_SECRET bearer. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ from: vi.fn(), captureError: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceClient: () => ({ from: mocks.from }) }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), metric: vi.fn() },
  captureError: mocks.captureError,
}))

describe('GET /api/health', () => {
  beforeEach(() => {
    mocks.from.mockReset(); mocks.captureError.mockReset()
    mocks.from.mockReturnValue({ select: () => ({ limit: async () => ({ error: null }) }) })
    process.env.CRON_SECRET = 'top-secret-cron'
    delete process.env.RAZORPAY_KEY_ID
  })

  it('public payload is exactly { ok, version } — no config keys, no DB call, no alert', async () => {
    const { GET } = await import('@/app/api/health/route')
    const res = await GET(new NextRequest('https://pahadiroots.com/api/health'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(Object.keys(body).sort()).toEqual(['ok', 'version'])
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.captureError).not.toHaveBeenCalled()
  })

  it('wrong bearer gets the public payload too', async () => {
    const { GET } = await import('@/app/api/health/route')
    const res = await GET(new NextRequest('https://pahadiroots.com/api/health', { headers: { authorization: 'Bearer nope' } }))
    expect(Object.keys(await res.json()).sort()).toEqual(['ok', 'version'])
  })

  it('CRON_SECRET bearer unlocks the detailed checks', async () => {
    const { GET } = await import('@/app/api/health/route')
    const res = await GET(new NextRequest('https://pahadiroots.com/api/health', { headers: { authorization: 'Bearer top-secret-cron' } }))
    const body = await res.json()
    expect(body).toHaveProperty('db'); expect(body).toHaveProperty('kv'); expect(body).toHaveProperty('razorpay')
    expect(mocks.from).toHaveBeenCalled()
  })
})
