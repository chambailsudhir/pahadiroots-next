// @vitest-environment jsdom
/**
 * auth-B #1 — the OAuth landing can no longer be used for login CSRF / session fixation:
 *  • /api/auth/session no longer stores caller-supplied tokens ('set' -> 410)
 *  • legacy /api/auth/google-callback never sets cookies, it only forwards to the landing page
 *  • the landing page ignores #access_token=… and posts only a ?code= to google_callback, once
 * plus unit tests for recoveryToken (#2) and peekRateLimitKv.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import React from 'react'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api/serverUtils', () => ({ checkCsrf: vi.fn(() => null) }))
vi.mock('@/lib/profileCache', () => ({
  buildCacheEntry: vi.fn((p: unknown) => p), writeProfileCache: vi.fn(), prefetchProfileToCache: vi.fn(),
}))
vi.mock('@/lib/analytics/ga4', () => ({ ga4Login: vi.fn() }))
vi.mock('server-only', () => ({}))

import { useUserStore } from '@/store/userStore'
import GoogleCallbackPage from '@/app/auth/google-callback/page'
import { isRecoveryToken, jwtAmrMethods } from '@/lib/auth/recoveryToken'
import { peekRateLimitKv } from '@/lib/api/rateLimitKv'

vi.mock('@/lib/supabase', () => ({ getServiceClient: vi.fn() }))

function sessionReq(body: unknown) {
  return new NextRequest('https://pahadiroots.com/api/auth/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://pahadiroots.com' }, body: JSON.stringify(body),
  })
}

describe('/api/auth/session', () => {
  it("action 'set' is gone: attacker tokens are never stored", async () => {
    const { POST } = await import('@/app/api/auth/session/route')
    const res = await POST(sessionReq({ action: 'set', access_token: 'ATTACKER', refresh_token: 'ATTACKER_R' }))
    expect(res.status).toBe(410)
    expect(res.headers.getSetCookie()).toEqual([])
  })
  it("'clear' still expires both cookies", async () => {
    const { POST } = await import('@/app/api/auth/session/route')
    const res = await POST(sessionReq({ action: 'clear' }))
    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie().filter(c => /Max-Age=0/i.test(c)).length).toBe(2)
  })
})

describe('legacy /api/auth/google-callback route', () => {
  it('never sets cookies or calls Supabase; forwards the query to the landing page', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    const { GET } = await import('@/app/api/auth/google-callback/route')
    const res = await GET(new NextRequest('https://pahadiroots.com/api/auth/google-callback?code=ATTACKER'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://www.pahadiroots.com/auth/google-callback?code=ATTACKER')
    expect(res.headers.getSetCookie()).toEqual([])
    expect(f).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('/auth/google-callback page', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, user: { id: 'u1', email: 'a@b.com' }, profile: { first_name: 'Asha', phone: '98' } }) })
    vi.stubGlobal('fetch', fetchMock)
    useUserStore.setState({ user: null })
    const loc = { href: '', pathname: '/auth/google-callback', search: '', hash: '' }
    Object.defineProperty(window, 'location', { value: loc, writable: true })
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  function land(search: string, hash: string) {
    const loc = window.location as unknown as { search: string; hash: string }
    loc.search = search; loc.hash = hash
  }

  it('posts ONLY the code, sets pr-user, then goes to /account', async () => {
    land('?code=GOODCODE', '')
    render(<GoogleCallbackPage />)
    await waitFor(() => expect(window.location.href).toBe('/account'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth')
    expect(JSON.parse(init.body)).toEqual({ action: 'google_callback', code: 'GOODCODE' })
    expect(useUserStore.getState().user?.id).toBe('u1')
  })

  it('ignores #access_token=… (login CSRF link): no request, no user, straight to /account', async () => {
    land('', '#access_token=ATTACKER&refresh_token=ATTACKER_R')
    render(<GoogleCallbackPage />)
    await waitFor(() => expect(window.location.href).toBe('/account'))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useUserStore.getState().user).toBeNull()
  })

  it('a rejected code shows the error and does not set the user', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Google sign-in expired' }) })
    land('?code=BAD', '')
    const { findByText } = render(<GoogleCallbackPage />)
    await findByText('Google sign-in expired')
    expect(useUserStore.getState().user).toBeNull()
  })

  it('a provider error in the query or hash is shown, no exchange attempted', async () => {
    land('?error=access_denied&error_description=User+cancelled', '')
    const { findByText } = render(<GoogleCallbackPage />)
    await findByText('User cancelled')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('recoveryToken (#2)', () => {
  const jwt = (amr: unknown) => `h.${Buffer.from(JSON.stringify({ amr })).toString('base64url')}.s`
  it('accepts recovery sessions only', () => {
    expect(isRecoveryToken(jwt([{ method: 'recovery', timestamp: 1 }]))).toBe(true)
    expect(isRecoveryToken(jwt(['recovery']))).toBe(true)
    expect(isRecoveryToken(jwt([{ method: 'otp' }]))).toBe(true)
    expect(isRecoveryToken(jwt([{ method: 'password' }]))).toBe(false)
    expect(isRecoveryToken(jwt([{ method: 'oauth' }]))).toBe(false)
    expect(isRecoveryToken(jwt([{ method: 'password' }, { method: 'recovery' }]))).toBe(true)
  })
  it('is false for junk', () => {
    for (const t of ['', 'abc', 'a.b.c', 'a..c', jwt('x'), jwt(null)]) expect(isRecoveryToken(t)).toBe(false)
    expect(jwtAmrMethods('a.b')).toEqual([])
  })
})

describe('peekRateLimitKv', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
  it('is false (not blocked) without Upstash and never throws', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', ''); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
    expect(await peekRateLimitKv('k', 3)).toBe(false)
  })
  it('reads the counter without incrementing', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://kv.example'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 't')
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: '3' }) })
    vi.stubGlobal('fetch', f)
    expect(await peekRateLimitKv('k:1', 3)).toBe(true)
    expect(await peekRateLimitKv('k:1', 4)).toBe(false)
    expect(String(f.mock.calls[0][0])).toBe('https://kv.example/get/k%3A1')
    f.mockResolvedValue({ ok: true, json: async () => ({ result: null }) })
    expect(await peekRateLimitKv('k:1', 1)).toBe(false)
    f.mockRejectedValue(new Error('down'))
    expect(await peekRateLimitKv('k:1', 1)).toBe(false)
  })
})
