/**
 * cpuReduction.test.tsx — regression guards for the Oct 2026 Fluid Active CPU
 * reduction: client code must not spend serverless invocations on visitors
 * who can't benefit from them.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, cleanup } from '@testing-library/react'

const userState = vi.hoisted(() => ({ user: null as unknown }))
const cacheState = vi.hoisted(() => ({ stale: true }))
const prefetchSpy = vi.hoisted(() => vi.fn())

vi.mock('@/store/userStore', () => ({ useUserStore: { getState: () => userState } }))
vi.mock('@/lib/profileCache', () => ({
  isProfileCacheStale: () => cacheState.stale,
  prefetchProfileToCache: prefetchSpy,
}))

import ProfilePrefetcher from '@/components/ProfilePrefetcher'
import { track } from '@/lib/analytics/track'

describe('ProfilePrefetcher — no /api/auth/session call unless it can help', () => {
  let fetchSpy: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ loggedIn: true }) })
    vi.stubGlobal('fetch', fetchSpy)
    prefetchSpy.mockClear()
    userState.user = null
    cacheState.stale = true
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('anonymous visitor → zero network calls', () => {
    render(<ProfilePrefetcher />)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('logged-in user with a fresh profile cache → zero network calls', () => {
    userState.user = { id: 'u1', phone: '9' }
    cacheState.stale = false
    render(<ProfilePrefetcher />)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('logged-in user with a stale cache → checks the session and refreshes the profile', async () => {
    userState.user = { id: 'u1', phone: '9' }
    render(<ProfilePrefetcher />)
    expect(fetchSpy).toHaveBeenCalledWith('/api/auth/session', expect.anything())
    await new Promise(r => setTimeout(r, 0))
    expect(prefetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('analytics track() — automated clients send no beacon', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('does not beacon when navigator.webdriver is set', () => {
    const beacon = vi.fn().mockReturnValue(true)
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true })
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true })
    track({ event_type: 'page_view', path: '/' })
    expect(beacon).not.toHaveBeenCalled()
    Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true })
  })

  it('does not beacon for a crawler user-agent', () => {
    const beacon = vi.fn().mockReturnValue(true)
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true })
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (compatible; Googlebot/2.1)')
    track({ event_type: 'page_view', path: '/' })
    expect(beacon).not.toHaveBeenCalled()
  })

  it('still beacons for a normal browser', () => {
    const beacon = vi.fn().mockReturnValue(true)
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true })
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1')
    track({ event_type: 'page_view', path: '/' })
    expect(beacon).toHaveBeenCalledTimes(1)
  })
})
