// @vitest-environment jsdom
/**
 * googleAuthHandler.test.tsx
 *
 * AUDIT S2-004 / S2-001 — GoogleAuthHandler is mounted in the ROOT layout,
 * so it runs on every page. It used to treat ANY `#access_token=…` on ANY
 * route as a Google login: POST google_callback → session cookie → /account.
 *
 *   • Login CSRF / session fixation: `/#access_token=<attacker>` signed the
 *     visitor in as the attacker (S2-004).
 *   • Password recovery links land on `/reset-password#access_token=…&
 *     type=recovery`; the handler swallowed them and logged the user in
 *     instead of letting them set a new password (S2-001).
 *
 * Fixed: the handler acts only on /auth/google-callback and never on a hash
 * whose type is `recovery`. On every other route it leaves the URL untouched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'

vi.mock('@/lib/profileCache', () => ({
  buildCacheEntry:        vi.fn(),
  writeProfileCache:      vi.fn(),
  prefetchProfileToCache: vi.fn(),
}))

import GoogleAuthHandler, { shouldHandleOAuthLanding, GOOGLE_CALLBACK_PATH } from '@/components/auth/GoogleAuthHandler'

const RECOVERY_HASH = '#access_token=RECOVERY_JWT&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery'
const LOGIN_HASH    = '#access_token=LOGIN_JWT&refresh_token=r&token_type=bearer'

function setLocation(pathAndHash: string) {
  window.history.replaceState({}, '', pathAndHash)
}

async function flush() {
  // let the async IIFE inside useEffect settle
  await new Promise(r => setTimeout(r, 0))
  await new Promise(r => setTimeout(r, 0))
}

describe('shouldHandleOAuthLanding (pure)', () => {
  it('is true only on the dedicated callback route with a plain login hash', () => {
    expect(shouldHandleOAuthLanding(GOOGLE_CALLBACK_PATH, LOGIN_HASH)).toBe(true)
    expect(shouldHandleOAuthLanding('/auth/google-callback/', LOGIN_HASH)).toBe(true)
  })

  it.each(['/', '/account', '/reset-password', '/checkout', '/auth/other'])(
    'is false on %s even with a login-shaped hash (S2-004)', (path) => {
      expect(shouldHandleOAuthLanding(path, LOGIN_HASH)).toBe(false)
    })

  it('is false for a recovery hash on ANY route, including the callback route itself (S2-001)', () => {
    expect(shouldHandleOAuthLanding('/reset-password', RECOVERY_HASH)).toBe(false)
    expect(shouldHandleOAuthLanding(GOOGLE_CALLBACK_PATH, RECOVERY_HASH)).toBe(false)
  })
})

describe('<GoogleAuthHandler /> (rendered)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) })
    vi.stubGlobal('fetch', fetchMock)
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    setLocation('/')
  })

  it('ignores a token hash on the homepage — no google_callback call, URL left intact (S2-004)', async () => {
    setLocation('/' + LOGIN_HASH)
    render(<GoogleAuthHandler />)
    await flush()

    expect(fetchMock).not.toHaveBeenCalled()
    // Before the fix the hash was stripped via replaceState and the token consumed.
    expect(window.location.hash).toBe(LOGIN_HASH)
  })

  it('ignores a recovery hash on /reset-password so the reset page can read it (S2-001)', async () => {
    setLocation('/reset-password' + RECOVERY_HASH)
    render(<GoogleAuthHandler />)
    await flush()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(window.location.hash).toBe(RECOVERY_HASH)
  })

  it('ignores a recovery hash even on /auth/google-callback', async () => {
    setLocation(GOOGLE_CALLBACK_PATH + RECOVERY_HASH)
    render(<GoogleAuthHandler />)
    await flush()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not eat a ?code= promo param outside the callback route, even with a stale PKCE verifier', async () => {
    localStorage.setItem('pr_pkce_verifier', 'stale')
    setLocation('/?code=SAVE20')
    render(<GoogleAuthHandler />)
    await flush()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(window.location.search).toBe('?code=SAVE20')
    expect(localStorage.getItem('pr_pkce_verifier')).toBe('stale')
  })

  it('still completes a Google login on the dedicated callback route', async () => {
    setLocation(GOOGLE_CALLBACK_PATH + LOGIN_HASH)
    render(<GoogleAuthHandler />)
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth')
    expect(JSON.parse(init.body)).toMatchObject({ action: 'google_callback', access_token: 'LOGIN_JWT' })
    // Token hash is stripped on the route where it IS consumed.
    expect(window.location.hash).toBe('')
  })
})
