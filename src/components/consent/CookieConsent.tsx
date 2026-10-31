'use client'

// ─────────────────────────────────────────────────────────────────────────────
// CookieConsent — first-visit banner + preferences dialog (see lib/consent.ts).
//
// Design rules (DPDP Act 2023 / GDPR / what large retailers ship):
//   • nothing non-essential runs before a choice; no pre-ticked boxes
//   • "Reject" is exactly as easy (same size, same weight, same screen) as "Accept"
//   • plain language, names what is collected and why, links the privacy policy
//   • the choice is reversible at any time (footer "Cookie Settings" → this dialog)
//   • fixed-position, so it never shifts layout (no CLS) and never blocks reading the page
//   • keyboard + screen-reader friendly: labelled dialog, focus moves in and returns, Esc closes
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  CONSENT_CHANGE_EVENT, COOKIE_SETTINGS_HASH, OPEN_PREFS_EVENT, hasAnalyticsConsent, isConsentRequired, loadGoogleTag, readConsent, writeConsent,
} from '@/lib/consent'

// Has the visitor already made a current choice? Read through useSyncExternalStore so the server and
// the first client render agree ("decided" => nothing rendered) and the banner appears right after
// hydration without a setState-in-effect.
function subscribeDecision(cb: () => void) {
  window.addEventListener(CONSENT_CHANGE_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => { window.removeEventListener(CONSENT_CHANGE_EVENT, cb); window.removeEventListener('storage', cb) }
}
// "Decided" also covers visitors for whom no choice is required (e.g. India before DPDP starts): no banner.
const getDecided = () => (readConsent() !== null || !isConsentRequired() ? 'y' : 'n')
const getDecidedServer = () => 'y'

const PALETTE = { bg: '#ffffff', text: '#1f2a24', muted: '#55625a', line: '#d9d4c7', accent: '#2d5a35', accentText: '#ffffff' }

const btn: React.CSSProperties = {
  minHeight: 44, padding: '10px 18px', borderRadius: 10, fontSize: 14, fontWeight: 700,
  cursor: 'pointer', border: `1.5px solid ${PALETTE.accent}`, background: PALETTE.accent,
  color: PALETTE.accentText, flex: '1 1 140px',
}
// Same size and weight as the accept button — only the colours are inverted.
const btnAlt: React.CSSProperties = { ...btn, background: PALETTE.bg, color: PALETTE.accent }
const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: '10px 6px', minHeight: 44, color: PALETTE.accent,
  fontSize: 14, fontWeight: 600, textDecoration: 'underline', cursor: 'pointer',
}

export default function CookieConsent({ tagId = '' }: { tagId?: string }) {
  const decided = useSyncExternalStore(subscribeDecision, getDecided, getDecidedServer) === 'y'
  const [prefsOpen, setPrefsOpen] = useState(false)
  // Covers the (rare) case where storage is blocked and the choice cannot be read back.
  const [dismissed, setDismissed] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const view: 'hidden' | 'banner' | 'prefs' = prefsOpen ? 'prefs' : (!decided && !dismissed ? 'banner' : 'hidden')
  const openerRef = useRef<HTMLElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  // Returning visitor who already said yes: make sure the tag is loaded (no-op if the inline bootstrap did it).
  useEffect(() => {
    if (hasAnalyticsConsent()) loadGoogleTag(tagId)
  }, [tagId])

  const openPrefs = useCallback(() => {
    openerRef.current = (document.activeElement as HTMLElement) ?? null
    setAnalytics(readConsent()?.analytics ?? !isConsentRequired())
    setPrefsOpen(true)
  }, [])

  // Footer link / programmatic open.
  useEffect(() => {
    const onOpen = () => openPrefs()
    window.addEventListener(OPEN_PREFS_EVENT, onOpen)
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href="' + COOKIE_SETTINGS_HASH + '"]')
      // Capture phase + stopPropagation: next/link would otherwise treat the hash as a navigation.
      if (a) { e.preventDefault(); e.stopPropagation(); openPrefs() }
    }
    document.addEventListener('click', onClick, true)
    return () => { window.removeEventListener(OPEN_PREFS_EVENT, onOpen); document.removeEventListener('click', onClick, true) }
  }, [openPrefs])

  const decide = useCallback((allowAnalytics: boolean) => {
    writeConsent(allowAnalytics)
    if (allowAnalytics) loadGoogleTag(tagId)
    setAnalytics(allowAnalytics)
    setPrefsOpen(false)
    setDismissed(true)
    openerRef.current?.focus?.()
  }, [tagId])

  // Preferences dialog: move focus in, trap Tab, Esc closes.
  useEffect(() => {
    if (view !== 'prefs') return
    const root = dialogRef.current
    root?.querySelector<HTMLElement>('input,button')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPrefsOpen(false); openerRef.current?.focus?.(); return }
      if (e.key !== 'Tab' || !root) return
      const f = Array.from(root.querySelectorAll<HTMLElement>('input,button,a[href]')).filter(el => !el.hasAttribute('disabled'))
      if (f.length === 0) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [view])

  if (view === 'hidden') return null

  const required = isConsentRequired()
  const wrap: React.CSSProperties = {
    position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 2147483646 /* above the chat widget (2147483645) so its FAB can never cover the Accept/Reject buttons */,
    padding: '12px 12px calc(12px + env(safe-area-inset-bottom, 0px))', pointerEvents: 'none',
  }
  const card: React.CSSProperties = {
    pointerEvents: 'auto', maxWidth: 440, margin: '0 auto', background: PALETTE.bg, color: PALETTE.text,
    border: `1px solid ${PALETTE.line}`, borderRadius: 14, boxShadow: '0 8px 30px rgba(0,0,0,.18)', padding: '16px 18px',
    fontFamily: 'var(--font-lato, Lato, system-ui, sans-serif)', fontSize: 14, lineHeight: 1.5,
  }

  if (view === 'banner') {
    return (
      <div style={wrap}>
        {/* Compact corner card on wide screens (does not cover the middle of the page); full-width sheet on phones. */}
        <style>{'@media (min-width: 640px){.hv-cc-card{margin:0 !important}}'}</style>
        <div className="hv-cc-card" role="dialog" aria-modal="false" aria-labelledby="hv-cc-title" aria-describedby="hv-cc-desc" style={card}>
          <h2 id="hv-cc-title" style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 800 }}>Your privacy, your choice</h2>
          <p id="hv-cc-desc" style={{ margin: '0 0 12px', color: PALETTE.muted }}>
            Essential cookies keep your cart and checkout working. With your permission we also use analytics (Google Analytics and a
            visitor ID) to see which products people like. No advertising cookies. See our{' '}
            <a href="/policies/privacy" style={{ color: PALETTE.accent, fontWeight: 600 }}>Privacy Policy</a>.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <button type="button" style={btnAlt} onClick={() => decide(false)}>Reject non-essential</button>
            <button type="button" style={btn} onClick={() => decide(true)}>Accept analytics</button>
            <button type="button" style={linkBtn} onClick={openPrefs}>Choose</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ ...wrap, top: 0, background: 'rgba(0,0,0,.45)', pointerEvents: 'auto', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="hv-cc-prefs-title" style={{ ...card, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 id="hv-cc-prefs-title" style={{ margin: '0 0 10px', fontSize: 17, fontWeight: 800 }}>Cookie settings</h2>

        <div style={{ padding: '10px 0', borderTop: `1px solid ${PALETTE.line}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <strong>Essential</strong><span style={{ color: PALETTE.muted, fontSize: 13 }}>Always on</span>
          </div>
          <p style={{ margin: '4px 0 0', color: PALETTE.muted }}>Keeps your cart, login session and secure checkout (including our payment partner) working. These cannot be switched off.</p>
        </div>

        <div style={{ padding: '10px 0', borderTop: `1px solid ${PALETTE.line}`, borderBottom: `1px solid ${PALETTE.line}` }}>
          <label htmlFor="hv-cc-analytics" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', cursor: 'pointer' }}>
            <strong>Analytics</strong>
            <input id="hv-cc-analytics" type="checkbox" checked={analytics} onChange={e => setAnalytics(e.target.checked)}
              style={{ width: 22, height: 22, accentColor: PALETTE.accent, cursor: 'pointer' }} />
          </label>
          <p style={{ margin: '4px 0 0', color: PALETTE.muted }}>
            Google Analytics and our own visitor ID show us which pages, products and searches are used, and where shoppers drop off.
            {required ? 'Off by default.' : 'On by default where you are; untick to opt out.'} You can change this any time from &ldquo;Cookie Settings&rdquo; in the footer.
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
          <button type="button" style={btnAlt} onClick={() => decide(false)}>Reject non-essential</button>
          <button type="button" style={btnAlt} onClick={() => decide(analytics)}>Save my choices</button>
          <button type="button" style={btn} onClick={() => decide(true)}>Accept analytics</button>
        </div>
      </div>
    </div>
  )
}
