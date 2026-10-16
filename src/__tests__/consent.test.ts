// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CONSENT_MAX_AGE_MS, CONSENT_STORAGE_KEY, CONSENT_VERSION, consentBootstrapScript, deleteGoogleCookies,
  googleConsentSignals, hasAnalyticsConsent, loadGoogleTag, readConsent, writeConsent, onConsentChange,
} from '@/lib/consent'

const w = window as any
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  delete w.gtag; delete w.dataLayer; delete w.__hvTagLoaded
  document.head.querySelectorAll('script').forEach(s => s.remove())
  document.cookie.split(';').forEach(c => { document.cookie = c.split('=')[0] + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' })
})

describe('Google Consent Mode v2 signals', () => {
  it('denies everything by default; never grants advertising signals', () => {
    expect(googleConsentSignals(false)).toMatchObject({ analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' })
    expect(googleConsentSignals(true)).toMatchObject({ analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' })
  })
})

describe('stored choice', () => {
  it('is undecided (null) with nothing stored — analytics OFF by default', () => {
    expect(readConsent()).toBeNull(); expect(hasAnalyticsConsent()).toBe(false)
  })
  it('round-trips, and rejects stale versions, expired choices, future timestamps and junk', () => {
    writeConsent(true); expect(hasAnalyticsConsent()).toBe(true)
    const now = Date.now()
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ v: CONSENT_VERSION + 1, ts: now, analytics: true })); expect(readConsent()).toBeNull()
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ v: CONSENT_VERSION, ts: now - CONSENT_MAX_AGE_MS - 1000, analytics: true })); expect(readConsent()).toBeNull()
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ v: CONSENT_VERSION, ts: now + 10 * 60_000, analytics: true })); expect(readConsent()).toBeNull()
    localStorage.setItem(CONSENT_STORAGE_KEY, '{nope'); expect(readConsent()).toBeNull()
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ v: CONSENT_VERSION, ts: now, analytics: 'yes' })); expect(readConsent()).toBeNull()
  })
  it('writeConsent tells Google and notifies listeners', () => {
    const cb = vi.fn(); const off = onConsentChange(cb)
    writeConsent(true)
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ analytics: true }))
    const last = Array.from(w.dataLayer).pop() as IArguments
    expect(Array.from(last)).toEqual(['consent', 'update', googleConsentSignals(true)])
    off()
  })
  it('withdrawing consent removes the visitor id, session ids and Google cookies', () => {
    writeConsent(true)
    localStorage.setItem('pr_vid', 'abc'); sessionStorage.setItem('pr_sid', 'x'); sessionStorage.setItem('pr_sid_meta', '{}')
    document.cookie = '_ga=GA1.1.1; path=/'; document.cookie = '_ga_ABC123=GS1; path=/'; document.cookie = 'keep=1; path=/'
    writeConsent(false)
    expect(localStorage.getItem('pr_vid')).toBeNull(); expect(sessionStorage.getItem('pr_sid')).toBeNull()
    expect(document.cookie).not.toMatch(/_ga/); expect(document.cookie).toMatch(/keep=1/)
    expect(hasAnalyticsConsent()).toBe(false)
  })
})

describe('loadGoogleTag', () => {
  it('loads gtag.js exactly once for a valid GA4 id, and never for an invalid one', () => {
    loadGoogleTag('<script>alert(1)</script>'); loadGoogleTag(''); loadGoogleTag('UA javascript:')
    expect(document.head.querySelectorAll('script').length).toBe(0)
    loadGoogleTag('G-ABC123XYZ'); loadGoogleTag('G-ABC123XYZ')
    const s = document.head.querySelectorAll('script'); expect(s.length).toBe(1)
    expect(s[0].src).toBe('https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ')
  })
  it('loads gtm.js for a GTM container id', () => {
    loadGoogleTag('GTM-ABCD12')
    expect(document.head.querySelector('script')!.src).toBe('https://www.googletagmanager.com/gtm.js?id=GTM-ABCD12')
  })
})

describe('consentBootstrapScript (inline <head> script)', () => {
  const run = (id: string) => { new Function(consentBootstrapScript(id))() }
  it('sets consent defaults to denied and loads NOTHING for a first-time visitor', () => {
    run('G-ABC123XYZ')
    const first = Array.from(w.dataLayer[0] as IArguments)
    expect(first).toEqual(['consent', 'default', googleConsentSignals(false)])
    expect(document.head.querySelectorAll('script').length).toBe(0)
  })
  it('loads nothing after a rejection', () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ v: CONSENT_VERSION, ts: Date.now(), analytics: false }))
    run('G-ABC123XYZ'); expect(document.head.querySelectorAll('script').length).toBe(0)
  })
  it('restores a previous YES: grants consent, then loads the tag', () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ v: CONSENT_VERSION, ts: Date.now(), analytics: true }))
    run('G-ABC123XYZ')
    const calls = w.dataLayer.map((a: IArguments) => Array.from(a)[0] + ':' + Array.from(a)[1])
    expect(calls.slice(0, 2)).toEqual(['consent:default', 'consent:update'])
    expect(document.head.querySelector('script')!.src).toContain('gtag/js?id=G-ABC123XYZ')
    expect(w.__hvTagLoaded).toBe(true)
  })
  it('ignores an expired or old-version YES, and never emits an unsafe id', () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ v: CONSENT_VERSION, ts: Date.now() - CONSENT_MAX_AGE_MS - 5000, analytics: true }))
    run('G-ABC123XYZ'); expect(document.head.querySelectorAll('script').length).toBe(0)
    expect(consentBootstrapScript("x');alert(1);//")).not.toContain('alert(1)')
  })
})

describe('deleteGoogleCookies', () => {
  it('only touches analytics cookies', () => {
    document.cookie = '_ga=1; path=/'; document.cookie = '_gid=1; path=/'; document.cookie = 'cart=1; path=/'
    deleteGoogleCookies()
    expect(document.cookie).toBe('cart=1')
  })
})
