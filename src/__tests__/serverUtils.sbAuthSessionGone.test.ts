/**
 * serverUtils.sbAuthSessionGone.test.ts
 *
 * AUDIT ACC-037 — live evidence: after a password change on another device (or logout) the old
 * session's token made GoTrue answer `403 session_not_found` on GET /user; callers only map
 * `status === 401` to "please log in again", so the browser got HTTP 500 "Profile fetch failed".
 * A token that can no longer be validated must surface as 401.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'

const fetchMock = vi.fn()
beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'service')
  vi.stubGlobal('fetch', fetchMock)
})
const resp = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })

describe('sbAuth — revoked sessions', () => {
  it.each([
    [403, { code: 403, error_code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' }],
    [403, { msg: 'forbidden' }],
    [401, { error_code: 'bad_jwt', msg: 'invalid JWT' }],
  ])('GET /user answering %s is surfaced as status 401', async (status, body) => {
    fetchMock.mockResolvedValueOnce(resp(status as number, body))
    const { sbAuth } = await import('@/lib/api/serverUtils')
    await expect(sbAuth('/user', null, 'stale-jwt')).rejects.toMatchObject({ status: 401 })
  })

  it('leaves other failures alone: a 5xx stays a 5xx, and a wrong password (/token) stays a 400', async () => {
    const { sbAuth } = await import('@/lib/api/serverUtils')
    fetchMock.mockResolvedValueOnce(resp(503, { msg: 'down' }))
    await expect(sbAuth('/user', null, 'jwt')).rejects.toMatchObject({ status: 503 })

    fetchMock.mockResolvedValueOnce(resp(400, { msg: 'Invalid login credentials' }))
    await expect(sbAuth('/token?grant_type=password', { email: 'a@b.com', password: 'x' })).rejects.toMatchObject({ status: 400 })
  })
})
