/**
 * Round-2 audit: GoTrue refresh tokens are single-use. tryRefresh() rotates one, but routes only attached the new cookies on
 * their SUCCESS path, so any later timeout / 4xx / 5xx left the browser holding the already-used token (next request = reuse
 * detection = surprise logout). tryRefresh now queues the new cookies in Next's cookie store itself, so every response carries them.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'

const set = vi.fn()
vi.mock('next/headers', () => ({ cookies: async () => ({ set }) }))
const fetchMock = vi.fn()
beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'service')
  vi.stubGlobal('fetch', fetchMock)
})
const resp = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) })
const reqWith = (cookie: string) => new NextRequest('https://www.pahadiroots.com/api/profile', { headers: { cookie } })

describe('tryRefresh', () => {
  it('queues the rotated tokens as HttpOnly cookies, independent of what the handler does next', async () => {
    set.mockClear()
    fetchMock.mockResolvedValueOnce(resp(200, { access_token: 'NEW_A', refresh_token: 'NEW_R' }))
    const { tryRefresh } = await import('@/lib/api/serverUtils')
    const r = await tryRefresh(reqWith('pr_refresh=OLD_R'))
    expect(r).toEqual({ token: 'NEW_A', refresh: 'NEW_R' })
    const calls = set.mock.calls.map(c => [c[0], c[1], c[2].httpOnly])
    expect(calls).toContainEqual(['pr_token', 'NEW_A', true])
    expect(calls).toContainEqual(['pr_refresh', 'NEW_R', true])
  })

  it('queues nothing when the refresh fails or there is no refresh cookie', async () => {
    set.mockClear()
    const { tryRefresh } = await import('@/lib/api/serverUtils')
    fetchMock.mockResolvedValueOnce(resp(400, { msg: 'Invalid Refresh Token' }))
    expect(await tryRefresh(reqWith('pr_refresh=BAD'))).toBeNull()
    expect(await tryRefresh(reqWith('x=1'))).toBeNull()
    expect(set).not.toHaveBeenCalled()
  })
})
