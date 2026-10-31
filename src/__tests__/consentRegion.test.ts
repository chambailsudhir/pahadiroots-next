// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { geoValueFor, isConsentRequiredFor, normalizeConsentMode } from '@/lib/consentRegion'
import { CONSENT_STORAGE_KEY, CONSENT_VERSION, consentBootstrapScript, hasAnalyticsConsent, isConsentRequired, writeConsent } from '@/lib/consent'

const w = window as any
function run(mode: string, geo?: string, id = 'G-ABC123XYZ') {
  document.cookie = geo ? `hv_geo=${geo}; path=/` : 'hv_geo=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
  new Function(consentBootstrapScript(id, mode))()
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); delete w.gtag; delete w.dataLayer; delete w.__hvTagLoaded; delete w.__hvConsentRequired
  document.head.querySelectorAll('script').forEach(s => s.remove())
})

describe('country classification', () => {
  it('EU, EEA, UK and Switzerland need consent; India and the rest do not; junk = unknown', () => {
    for (const c of ['DE', 'fr', 'IE', 'NO', 'GB', 'CH']) expect(geoValueFor(c)).toBe('eu')
    for (const c of ['IN', 'US', 'AE', 'SG']) expect(geoValueFor(c)).toBe('row')
    for (const c of [undefined, null, '', 'XX1', '??', 'India']) expect(geoValueFor(c as any)).toBe('unk')
  })
  it('mode rule: region asks EU+unknown only, always asks everyone, off asks nobody', () => {
    expect(isConsentRequiredFor('region', 'row')).toBe(false)
    expect(isConsentRequiredFor('region', 'eu')).toBe(true)
    expect(isConsentRequiredFor('region', 'unk')).toBe(true)
    expect(isConsentRequiredFor('region', undefined)).toBe(true)
    expect(isConsentRequiredFor('always', 'row')).toBe(true)
    expect(isConsentRequiredFor('off', 'eu')).toBe(false)
  })
  it('unknown/garbage settings fall back to the safe default (region)', () => {
    expect(normalizeConsentMode('nope')).toBe('region'); expect(normalizeConsentMode(undefined)).toBe('region')
    expect(normalizeConsentMode('always')).toBe('always'); expect(normalizeConsentMode('off')).toBe('off')
  })
})

// The bootstrap now injects the tag after window load + idle (requestIdleCallback, or a 1ms timeout where unavailable).
const flushDeferredTag = () => new Promise<void>(r => setTimeout(r, 30))

describe('bootstrap by region', () => {
  it('INDIA (region mode): no banner needed, analytics ON by default, tag loads, consent granted', async () => {
    run('region', 'row')
    expect(w.__hvConsentRequired).toBe(false); expect(isConsentRequired()).toBe(false)
    expect(hasAnalyticsConsent()).toBe(true)
    const calls = w.dataLayer.map((a: IArguments) => Array.from(a).slice(0, 2).join(':'))
    expect(calls.slice(0, 2)).toEqual(['consent:default', 'consent:update'])
    // PERF: the 180KB gtag.js download is deferred until after load + idle, not started during HTML parse.
    expect(document.head.querySelectorAll('script').length).toBe(0)
    await flushDeferredTag()
    expect(document.head.querySelector('script')!.src).toContain('gtag/js?id=G-ABC123XYZ')
  })
  it('EU/UK (region mode): consent required, analytics OFF, tag NOT loaded', () => {
    run('region', 'eu')
    expect(w.__hvConsentRequired).toBe(true); expect(hasAnalyticsConsent()).toBe(false)
    expect(document.head.querySelectorAll('script').length).toBe(0)
  })
  it('unknown country (no cookie, e.g. first byte / local dev) is treated as required — the safe side', () => {
    run('region', undefined)
    expect(w.__hvConsentRequired).toBe(true); expect(document.head.querySelectorAll('script').length).toBe(0)
  })
  it("'always' asks even in India; 'off' never asks even in the EU", async () => {
    run('always', 'row'); expect(w.__hvConsentRequired).toBe(true); await flushDeferredTag(); expect(document.head.querySelectorAll('script').length).toBe(0)
    delete w.dataLayer; delete w.__hvTagLoaded
    run('off', 'eu'); expect(w.__hvConsentRequired).toBe(false); await flushDeferredTag(); expect(document.head.querySelectorAll('script').length).toBe(1)
  })
  it('an explicit opt-out is respected even where consent is not required (India visitor unticks analytics)', () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ v: CONSENT_VERSION, ts: Date.now(), analytics: false }))
    run('region', 'row')
    expect(hasAnalyticsConsent()).toBe(false); expect(document.head.querySelectorAll('script').length).toBe(0)
  })
  it('still sets the flags and consent defaults when no tag id is configured (tracker + banner need them)', () => {
    run('region', 'row', '')
    expect(w.__hvConsentRequired).toBe(false); expect(document.head.querySelectorAll('script').length).toBe(0)
  })
  it('withdrawing in India works and sticks', () => {
    run('region', 'row'); expect(hasAnalyticsConsent()).toBe(true)
    writeConsent(false); expect(hasAnalyticsConsent()).toBe(false)
  })
})
