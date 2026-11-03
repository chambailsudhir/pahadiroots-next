/**
 * Round-2 audit: the proxy read store_open / the CSP bootstrap settings on EVERY navigation once the short caches expired, and a
 * failed bootstrap read was retried by every request (each waiting up to 1.5 s on the slow database). Concurrent callers now share
 * one read, and a failed bootstrap read is not retried for 5 s.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

async function loadProxy() {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  return import('@/proxy')
}
const req = (path: string) => new NextRequest(`https://pahadiroots.com${path}`, { method: 'GET' })
const urlOf = (c: unknown[]) => String(c[0])

describe('proxy single flight', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T10:00:00Z')) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  it('N concurrent navigations with a cold cache cause ONE store_open read', async () => {
    let release!: (r: Response) => void
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(res => { release = res }))
    vi.stubGlobal('fetch', fetchMock)
    const { proxy } = await loadProxy()

    const all = Promise.all([proxy(req('/')), proxy(req('/')), proxy(req('/')), proxy(req('/'))])
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    release(new Response(JSON.stringify([{ value: 'true' }]), { status: 200 }))
    await all
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a failed bootstrap-settings read is not retried by the next requests for 5 s, then it is', async () => {
    const fetchMock = vi.fn().mockImplementation(async (u: unknown) => {
      if (String(u).includes('key=in.(google_tag_id')) return new Response('boom', { status: 503 })
      return new Response(JSON.stringify([{ value: 'true' }]), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { proxy } = await loadProxy()
    const bootstrapCalls = () => fetchMock.mock.calls.filter(c => urlOf(c).includes('google_tag_id')).length

    await proxy(req('/account'))
    await proxy(req('/account'))
    await proxy(req('/checkout'))
    expect(bootstrapCalls()).toBe(1)

    vi.advanceTimersByTime(6_000)
    await proxy(req('/account'))
    expect(bootstrapCalls()).toBe(2)
  })
})
