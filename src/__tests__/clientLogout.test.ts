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
import { clearServerSession, performHeaderLogout, clearClientPII, CLIENT_PII_STORAGE_KEYS } from '@/lib/clientLogout'
import { PROFILE_CACHE_KEY } from '@/lib/profileCache'

// AUDIT S2-006: what the checkout prefill cache looks like for a signed-in user.
const CACHED_PROFILE = JSON.stringify({
  cachedAt: Date.now(),
  profile: { first_name: 'Asha', email: 'asha@example.com', phone: '9876543210', address_line1: '12 Mall Road' },
  savedAddresses: [{ name: 'Asha', phone: '9876543210', address_line1: '12 Mall Road', city: 'Dehradun' }],
})

function seedPII() {
  localStorage.setItem(PROFILE_CACHE_KEY, CACHED_PROFILE)
  localStorage.setItem('pr_pkce_verifier', 'v')
  localStorage.setItem('pr_auth_token', 'legacy-jwt')
  localStorage.setItem('pr_auth_refresh', 'legacy-rt')
  localStorage.setItem('pr_auth_profile', '{"email":"asha@example.com"}')
}

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

  // ── AUDIT S2-006: logout must clear the checkout profile cache ──────────
  describe('client PII cache (AUDIT S2-006)', () => {
    beforeEach(() => {
      localStorage.clear()
      seedPII()
    })

    it('clearClientPII removes pr_checkout_profile and every legacy auth key', () => {
      expect(localStorage.getItem(PROFILE_CACHE_KEY)).not.toBeNull()

      clearClientPII()

      // This is the bug: pr_checkout_profile survived logout, so the next
      // shopper on the device got the previous user's name/phone/address.
      expect(localStorage.getItem(PROFILE_CACHE_KEY)).toBeNull()
      for (const key of CLIENT_PII_STORAGE_KEYS) expect(localStorage.getItem(key)).toBeNull()
    })

    it('clearServerSession wipes local PII even when both network calls fail', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

      await clearServerSession()

      expect(localStorage.getItem(PROFILE_CACHE_KEY)).toBeNull()
      expect(localStorage.getItem('pr_auth_token')).toBeNull()
    })

    it('performHeaderLogout leaves no PII in localStorage (checkout cache gone, pr-user holds no user/addresses)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
      useUserStore.setState({
        user: { id: 'u1', email: 'asha@example.com', name: 'Asha', phone: '9876543210' },
        savedAddresses: [{ id: 'a1', name: 'Asha', phone: '9876543210', address_line1: '12 Mall Road' } as never],
        wishlist: ['prod-1'],
      })

      await performHeaderLogout()

      expect(localStorage.getItem(PROFILE_CACHE_KEY)).toBeNull()
      const everything = Object.keys(localStorage).map(k => localStorage.getItem(k) ?? '').join('\n')
      expect(everything).not.toContain('asha@example.com')
      expect(everything).not.toContain('9876543210')
      expect(everything).not.toContain('12 Mall Road')
      // Wishlist (product ids only, not PII) is intentionally preserved — userStore.ts.
      expect(useUserStore.getState().wishlist).toEqual(['prod-1'])
    })

    it('clearClientPII is a safe no-op when localStorage throws (private mode / quota)', () => {
      const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('SecurityError') })
      expect(() => clearClientPII()).not.toThrow()
      spy.mockRestore()
    })
  })
})
