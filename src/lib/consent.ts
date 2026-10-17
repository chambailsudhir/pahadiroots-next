// ─────────────────────────────────────────────────────────────────────────────
// lib/consent.ts — cookie / analytics consent (client-side).
//
// Oct 2026 (launch readiness): Google Analytics / GTM and the in-house visitor tracker
// (persistent `pr_vid` visitor id) used to run for every visitor from the first page view.
// India's DPDP Act 2023 (and GDPR/UK-GDPR for overseas visitors) expect an informed,
// affirmative choice BEFORE non-essential tracking starts. This module is the single source
// of truth for that choice:
//
//   • where consent is required (EEA/UK/CH, or everyone if the owner chose so): default = NO analytics
//     (opt-in, never pre-ticked). Elsewhere (e.g. India until DPDP starts 14 May 2027): analytics runs
//     by default and the visitor can opt out any time. See lib/consentRegion.ts
//   • choice is stored first-party (localStorage `hv_consent`) with a version + timestamp,
//     expires after 12 months, and is re-asked when CONSENT_VERSION changes
//   • Google Consent Mode v2: every ad/analytics signal is "denied" until granted. We run NO
//     advertising products, so ad_storage / ad_user_data / ad_personalization stay denied always
//   • the Google tag (gtag.js or GTM) is not even downloaded until analytics consent is granted
//   • withdrawing consent stops tracking, deletes the Google cookies and the in-house visitor id
//   • the choice can be changed any time from the footer ("Cookie Settings")
//
// Strictly-necessary storage (cart, login session, checkout) needs no consent and is untouched.
// ─────────────────────────────────────────────────────────────────────────────

export const CONSENT_STORAGE_KEY = 'hv_consent'
export const CONSENT_VERSION = 1
export const CONSENT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000
export const OPEN_PREFS_EVENT = 'hv:open-consent'
export const CONSENT_CHANGE_EVENT = 'hv:consent-change'
/** Anchor used by footer links; CookieConsent turns a click on it into "open preferences". */
export const COOKIE_SETTINGS_HASH = '#cookie-settings'

import { GEO_COOKIE, normalizeConsentMode, type ConsentMode } from '@/lib/consentRegion'

export interface ConsentState {
  v: number
  ts: number
  analytics: boolean
}

type GtagFn = (...args: unknown[]) => void
interface ConsentWindow extends Window {
  gtag?: GtagFn
  dataLayer?: unknown[]
  __hvTagLoaded?: boolean
  __hvConsentRequired?: boolean
}

/** Same ids layout.tsx already accepts: GA4 (G-), Google tag (GT-), GTM (GTM-). */
export const TAG_ID_RE = /^(G|GT|GTM|AW)-[A-Z0-9-]{3,20}$/i

export function googleConsentSignals(analytics: boolean) {
  return {
    analytics_storage: analytics ? 'granted' : 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
  } as const
}

/** The stored decision, or null when the visitor has not decided (or it expired / is an old version). */
export function readConsent(now: number = Date.now()): ConsentState | null {
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as Partial<ConsentState>
    if (!c || c.v !== CONSENT_VERSION || typeof c.ts !== 'number' || typeof c.analytics !== 'boolean') return null
    if (now - c.ts > CONSENT_MAX_AGE_MS || c.ts > now + 60_000) return null
    return { v: c.v, ts: c.ts, analytics: c.analytics }
  } catch {
    return null
  }
}

/**
 * Must this visitor choose before analytics starts? Decided once by the inline bootstrap script from the
 * owner's setting + the visitor's country. Defaults to TRUE (ask) whenever that is unknown.
 */
export function isConsentRequired(): boolean {
  if (typeof window === 'undefined') return true
  const v = (window as ConsentWindow).__hvConsentRequired
  return typeof v === 'boolean' ? v : true
}

/**
 * Is analytics allowed right now? An explicit stored choice always wins. With no choice: allowed only where
 * consent is not required (e.g. India before DPDP starts), never where it is. Safe on the server (false).
 */
export function hasAnalyticsConsent(): boolean {
  if (typeof window === 'undefined') return false
  const c = readConsent()
  if (c) return c.analytics
  return !isConsentRequired()
}

function ensureGtag(w: ConsentWindow): GtagFn {
  w.dataLayer = w.dataLayer || []
  if (typeof w.gtag !== 'function') {
    // Must push the `arguments` object (not an array) — that is what gtag.js expects.
    w.gtag = function gtag() { (w.dataLayer as unknown[]).push(arguments) }
  }
  return w.gtag as GtagFn
}

export function applyGoogleConsent(analytics: boolean): void {
  if (typeof window === 'undefined') return
  const w = window as ConsentWindow
  ensureGtag(w)('consent', 'update', googleConsentSignals(analytics))
}

/** Removes Google Analytics cookies (_ga, _ga_*, _gid, _gat*) on this host and its parent domain. */
export function deleteGoogleCookies(): void {
  if (typeof document === 'undefined') return
  const names = document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(n => /^(_ga|_gid|_gat|_gcl)/.test(n))
  const host = window.location.hostname
  const parts = host.split('.')
  const domains = ['', host, ...(parts.length > 2 ? ['.' + parts.slice(-2).join('.')] : ['.' + host])]
  for (const n of names) {
    for (const d of domains) {
      document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d ? `; domain=${d}` : ''}`
    }
  }
}

/** Downloads + starts the Google tag, once, and only for a validated id. Call only after consent. */
export function loadGoogleTag(tagId: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const w = window as ConsentWindow
  const id = (tagId || '').trim()
  if (!TAG_ID_RE.test(id) || w.__hvTagLoaded) return
  w.__hvTagLoaded = true
  const gtag = ensureGtag(w)
  const s = document.createElement('script')
  s.async = true
  if (/^GTM-/i.test(id)) {
    ;(w.dataLayer as unknown[]).push({ 'gtm.start': Date.now(), event: 'gtm.js' })
    s.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`
  } else {
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`
    gtag('js', new Date())
    gtag('config', id)
  }
  document.head.appendChild(s)
}

/** Stores the decision, tells Google, notifies listeners, and cleans up on withdrawal. */
export function writeConsent(analytics: boolean, now: number = Date.now()): ConsentState {
  const state: ConsentState = { v: CONSENT_VERSION, ts: now, analytics }
  try { window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(state)) } catch { /* storage blocked: decision lasts this page only */ }
  applyGoogleConsent(analytics)
  if (!analytics) {
    deleteGoogleCookies()
    try { window.localStorage.removeItem('pr_vid') } catch { /* ignore */ }
    try { window.sessionStorage.removeItem('pr_sid'); window.sessionStorage.removeItem('pr_sid_meta') } catch { /* ignore */ }
  }
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: state }))
  return state
}

export function onConsentChange(cb: (s: ConsentState) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<ConsentState>).detail)
  window.addEventListener(CONSENT_CHANGE_EVENT, h)
  return () => window.removeEventListener(CONSENT_CHANGE_EVENT, h)
}

export function openConsentPreferences(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_PREFS_EVENT))
}

/**
 * Inline <head> script, runs before any other script:
 *  1. defines gtag and sets Consent Mode v2 defaults to DENIED
 *  2. works out whether consent is required here (owner setting `mode` + `hv_geo` cookie from proxy.ts)
 *  3. analytics is "on" when the visitor chose yes, or has not chosen and consent is not required
 *  4. only then: grants analytics_storage and loads the tag
 * ES5 on purpose; keep the logic in sync with consentRegion.ts / loadGoogleTag above. Runs even without a
 * tag id (the in-house tracker and the banner also need `__hvConsentRequired`).
 */
export function consentBootstrapScript(tagId: string, mode: ConsentMode | string = 'region'): string {
  const id = (tagId || '').trim()
  const safeId = TAG_ID_RE.test(id) ? id : ''
  const denied = JSON.stringify(googleConsentSignals(false))
  const granted = JSON.stringify(googleConsentSignals(true))
  return `(function(){try{var w=window;w.dataLayer=w.dataLayer||[];function gtag(){w.dataLayer.push(arguments)}w.gtag=w.gtag||gtag;gtag('consent','default',${denied});`
    + `var MODE=${JSON.stringify(normalizeConsentMode(mode))};var g=(document.cookie.match(/(?:^|;\s*)${GEO_COOKIE}=([a-z]+)/)||[])[1]||'unk';`
    + `var req=MODE==='always'?true:(MODE==='off'?false:g!=='row');w.__hvConsentRequired=req;`
    + `var ID=${JSON.stringify(safeId)};var c=null;try{c=JSON.parse(w.localStorage.getItem(${JSON.stringify(CONSENT_STORAGE_KEY)}))}catch(e){}`
    + `var ok=c&&c.v===${CONSENT_VERSION}&&typeof c.ts==='number'&&typeof c.analytics==='boolean'&&Date.now()-c.ts<${CONSENT_MAX_AGE_MS}&&c.ts<=Date.now()+60000;`
    + `var on=ok?c.analytics===true:!req;`
    + `if(on){gtag('consent','update',${granted});if(ID){w.__hvTagLoaded=true;var s=document.createElement('script');s.async=true;`
    + `if(/^GTM-/i.test(ID)){w.dataLayer.push({'gtm.start':Date.now(),event:'gtm.js'});s.src='https://www.googletagmanager.com/gtm.js?id='+encodeURIComponent(ID)}`
    + `else{s.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(ID);gtag('js',new Date());gtag('config',ID)}`
    + `document.head.appendChild(s)}}}catch(e){}})();`
}
