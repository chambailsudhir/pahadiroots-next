// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import CookieConsent from '@/components/consent/CookieConsent'
import { CONSENT_STORAGE_KEY, CONSENT_VERSION, readConsent, openConsentPreferences } from '@/lib/consent'

const w = window as any
beforeEach(() => {
  cleanup(); localStorage.clear(); sessionStorage.clear()
  delete w.gtag; delete w.dataLayer; delete w.__hvTagLoaded
  document.head.querySelectorAll('script').forEach(s => s.remove())
})

describe('CookieConsent banner', () => {
  it('shows on a first visit, loads NOTHING, and makes Reject as available as Accept', () => {
    render(<CookieConsent tagId="G-ABC123XYZ" />)
    expect(screen.getByRole('dialog', { name: /your privacy/i })).toBeTruthy()
    const reject = screen.getByRole('button', { name: /reject non-essential/i }) as HTMLButtonElement
    const accept = screen.getByRole('button', { name: /accept analytics/i }) as HTMLButtonElement
    // identical size/weight: equal prominence
    expect(reject.style.minHeight).toBe(accept.style.minHeight); expect(reject.style.fontWeight).toBe(accept.style.fontWeight)
    expect(document.head.querySelectorAll('script').length).toBe(0)
    expect(readConsent()).toBeNull()
  })
  it('Accept stores the choice, hides the banner and loads the Google tag', () => {
    render(<CookieConsent tagId="G-ABC123XYZ" />)
    fireEvent.click(screen.getByRole('button', { name: /accept analytics/i }))
    expect(readConsent()?.analytics).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.head.querySelector('script')!.src).toContain('gtag/js?id=G-ABC123XYZ')
  })
  it('Reject stores "no", hides the banner and loads nothing', () => {
    render(<CookieConsent tagId="G-ABC123XYZ" />)
    fireEvent.click(screen.getByRole('button', { name: /reject non-essential/i }))
    expect(readConsent()?.analytics).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.head.querySelectorAll('script').length).toBe(0)
  })
  it('does not show again once a current choice exists', () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ v: CONSENT_VERSION, ts: Date.now(), analytics: false }))
    render(<CookieConsent tagId="G-ABC123XYZ" />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('re-asks when the stored choice is from an older consent version', () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ v: CONSENT_VERSION - 1, ts: Date.now(), analytics: true }))
    render(<CookieConsent tagId="G-ABC123XYZ" />)
    expect(screen.getByRole('dialog', { name: /your privacy/i })).toBeTruthy()
  })
})

describe('CookieConsent preferences', () => {
  it('"Choose" opens a modal with analytics OFF by default; saving ON stores yes', () => {
    render(<CookieConsent tagId="G-ABC123XYZ" />)
    fireEvent.click(screen.getByRole('button', { name: /^choose$/i }))
    const box = screen.getByRole('checkbox', { name: /analytics/i }) as HTMLInputElement
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: /save my choices/i }))
    expect(readConsent()?.analytics).toBe(true)
  })
  it('footer link (#cookie-settings) and openConsentPreferences() reopen it; withdrawing works', () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ v: CONSENT_VERSION, ts: Date.now(), analytics: true }))
    const { container } = render(<><a href="#cookie-settings">Cookie Settings</a><CookieConsent tagId="G-ABC123XYZ" /></>)
    fireEvent.click(container.querySelector('a')!)
    const box = screen.getByRole('checkbox', { name: /analytics/i }) as HTMLInputElement
    expect(box.checked).toBe(true)
    fireEvent.click(box); fireEvent.click(screen.getByRole('button', { name: /save my choices/i }))
    expect(readConsent()?.analytics).toBe(false)
    act(() => { openConsentPreferences() })
    expect(screen.getByRole('dialog', { name: /cookie settings/i })).toBeTruthy()
  })
  it('Escape closes the dialog without changing the stored choice', () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ v: CONSENT_VERSION, ts: Date.now(), analytics: true }))
    render(<CookieConsent tagId="G-ABC123XYZ" />)
    act(() => { openConsentPreferences() })
    expect(screen.getByRole('dialog', { name: /cookie settings/i })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(readConsent()?.analytics).toBe(true)
  })
})
