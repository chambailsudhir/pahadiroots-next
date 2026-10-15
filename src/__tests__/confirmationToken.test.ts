// @vitest-environment jsdom
/**
 * F-01 / F-10 — the guest confirmation token must never ride in the URL.
 *
 * The URL goes to Google Tag Manager / GA4 (default page_view reports the full page URL), browser
 * history and referrers; the token unlocks the guest's name, phone and address.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  stashConfirmationToken, readConfirmationToken, absorbUrlToken, resolveConfirmationToken,
  isConfirmationTokenExpired, CONFIRMATION_TOKEN_TTL_MS,
} from '@/lib/confirmationToken'
import { ANALYTICS_URL_GUARD_SCRIPT } from '@/lib/analyticsGuard'

const TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

beforeEach(() => {
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('stash / read', () => {
  it('round-trips per order number', () => {
    stashConfirmationToken('PR1A2B3C4D', TOKEN)
    expect(readConfirmationToken('PR1A2B3C4D')).toBe(TOKEN)
    expect(readConfirmationToken('PROTHER123')).toBe('')
  })

  it('refuses malformed order numbers and tokens (nothing is stored)', () => {
    stashConfirmationToken("x' OR '1'='1", TOKEN)
    stashConfirmationToken('PR1A2B3C4D', 'not-a-uuid')
    stashConfirmationToken('PR1A2B3C4D', undefined)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('never throws when storage is unavailable', () => {
    const orig = Object.getOwnPropertyDescriptor(window, 'sessionStorage')!
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new Error('denied') } })
    try {
      expect(() => stashConfirmationToken('PR1A2B3C4D', TOKEN)).not.toThrow()
      expect(readConfirmationToken('PR1A2B3C4D')).toBe('')
    } finally {
      Object.defineProperty(window, 'sessionStorage', orig)
    }
  })
})

describe('legacy ?token= URL absorption', () => {
  it('moves the token into storage and scrubs it from the address bar', () => {
    window.history.replaceState(null, '', `/order-success?id=PR1A2B3C4D&method=cod&token=${TOKEN}`)
    expect(absorbUrlToken('PR1A2B3C4D')).toBe(TOKEN)
    expect(window.location.search).not.toContain('token')
    expect(window.location.search).toContain('id=PR1A2B3C4D')
    expect(readConfirmationToken('PR1A2B3C4D')).toBe(TOKEN)
  })

  it('is a no-op when the URL has no token', () => {
    window.history.replaceState(null, '', '/order-success?id=PR1A2B3C4D')
    expect(absorbUrlToken('PR1A2B3C4D')).toBe('')
  })

  it('still scrubs a malformed token but does not store it', () => {
    window.history.replaceState(null, '', '/order-success?id=PR1A2B3C4D&token=garbage')
    expect(absorbUrlToken('PR1A2B3C4D')).toBe('')
    expect(window.location.search).not.toContain('token')
    expect(window.sessionStorage.length).toBe(0)
  })

  it('resolveConfirmationToken prefers a legacy URL token, else the stash', () => {
    stashConfirmationToken('PR1A2B3C4D', TOKEN)
    expect(resolveConfirmationToken('PR1A2B3C4D')).toBe(TOKEN)
  })
})

describe('inline <head> guard (runs BEFORE any analytics tag)', () => {
  it('scrubs the token on /order-success and stores it under the same key the page reads', () => {
    window.history.replaceState(null, '', `/order-success?id=PR1A2B3C4D&token=${TOKEN}`)
    // eslint-disable-next-line no-new-func
    new Function(ANALYTICS_URL_GUARD_SCRIPT)()
    expect(window.location.href).not.toContain(TOKEN)
    expect(readConfirmationToken('PR1A2B3C4D')).toBe(TOKEN)
  })

  it('leaves every other path alone (Google sign-in callback legitimately uses ?token=)', () => {
    window.history.replaceState(null, '', `/auth/google-callback?token=${TOKEN}`)
    // eslint-disable-next-line no-new-func
    new Function(ANALYTICS_URL_GUARD_SCRIPT)()
    expect(window.location.search).toContain(`token=${TOKEN}`)
  })

  it('contains nothing that the "no analytics when unset" layout test would mistake for a tag', () => {
    expect(ANALYTICS_URL_GUARD_SCRIPT).not.toMatch(/gtag|googletagmanager|gtm\.js/)
  })
})

describe('F-10 expiry', () => {
  const now = Date.parse('2026-10-15T00:00:00Z')
  it('valid inside the lifetime, expired after it', () => {
    expect(isConfirmationTokenExpired(new Date(now - CONFIRMATION_TOKEN_TTL_MS + 1000).toISOString(), now)).toBe(false)
    expect(isConfirmationTokenExpired(new Date(now - CONFIRMATION_TOKEN_TTL_MS - 1000).toISOString(), now)).toBe(true)
  })
  it('fails closed on junk', () => {
    expect(isConfirmationTokenExpired(null, now)).toBe(true)
    expect(isConfirmationTokenExpired('', now)).toBe(true)
  })
})
