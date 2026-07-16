// @vitest-environment jsdom
/**
 * clientLogout.test.ts
 *
 * Covers the P1 audit fix: Header.tsx's account-dropdown "Logout" button
 * was previously `<Link href="/account">` — it never cleared the httpOnly
 * session cookie or the client user store, so clicking it left the user
 * fully logged in.
 *
 * These tests prove the real fix — performHeaderLogout() — actually:
 *   1. Calls both session-clearing endpoints (session cookie + auth route)
 *   2. Clears useUserStore's user/wishlist state via its logout() action
 *   3. Still clears local state even if the network calls fail (offline,
 *      expired cookie already gone, etc. — logout must never get "stuck")
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useUserStore } from '@/store/userStore'
import { clearServerSession, performHeaderLogout } from '@/lib/clientLogout'

describe('clientLogout', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Reload not implemented in jsdom — stub it so performHeaderLogout()
    // doesn't throw when it tries to call window.location.reload().
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: vi.fn() },
      writable: true,
    })
    useUserStore.setState({
      user: { id: 'u1', email: 'test@example.com', name: 'Test', phone: '' },
      wishlist: ['prod-1'],
    })
  })

  it('clearServerSession calls both the session-clear and logout endpoints', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    await clearServerSession()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const urls = fetchMock.mock.calls.map(c => c[0])
    expect(urls).toContain('/api/auth/session')
    expect(urls).toContain('/api/auth')
    const sessionCall = fetchMock.mock.calls.find(c => c[0] === '/api/auth/session')!
    expect(JSON.parse(sessionCall[1].body)).toEqual({ action: 'clear' })
    const authCall = fetchMock.mock.calls.find(c => c[0] === '/api/auth')!
    expect(JSON.parse(authCall[1].body)).toEqual({ action: 'logout' })
  })

  it('performHeaderLogout clears the user store even when both network calls fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    expect(useUserStore.getState().user).not.toBeNull()

    await performHeaderLogout()

    // This is the actual bug this fix addresses: logout must not silently
    // leave the previous user's session intact.
    expect(useUserStore.getState().user).toBeNull()
    expect(window.location.reload).toHaveBeenCalled()
  })

  it('performHeaderLogout clears the user store on the happy path too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))

    await performHeaderLogout()

    expect(useUserStore.getState().user).toBeNull()
    expect(window.location.reload).toHaveBeenCalled()
  })
})
