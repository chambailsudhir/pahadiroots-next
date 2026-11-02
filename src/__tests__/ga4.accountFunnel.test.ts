// @vitest-environment jsdom
/** ACC-020 — account-funnel analytics: recommended GA4 events, a fixed vocabulary, no personal data, consent respected. */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const consent = vi.hoisted(() => ({ granted: true }))
vi.mock('@/lib/consent', () => ({ hasAnalyticsConsent: () => consent.granted }))
import { ga4Login, ga4SignUp, ga4AccountAction } from '@/lib/analytics/ga4'

const gtag = vi.fn()
beforeEach(() => { gtag.mockReset(); consent.granted = true; (window as unknown as { gtag: unknown }).gtag = gtag })

describe('account funnel events', () => {
  it('login / sign_up use the GA4 recommended names with only a method', () => {
    ga4Login('email'); ga4SignUp('google')
    expect(gtag).toHaveBeenCalledWith('event', 'login',   { method: 'email' })
    expect(gtag).toHaveBeenCalledWith('event', 'sign_up', { method: 'google' })
  })

  it('account_action carries ONLY a fixed action name — nothing identifying', () => {
    ga4AccountAction('order_cancelled')
    expect(gtag).toHaveBeenCalledWith('event', 'account_action', { action: 'order_cancelled' })
    const sent = JSON.stringify(gtag.mock.calls)
    expect(sent).not.toMatch(/@|ORD-|\d{10}|eyJ/)
  })

  it('sends nothing without analytics consent', () => {
    consent.granted = false
    ga4Login('email'); ga4SignUp('email'); ga4AccountAction('address_saved')
    expect(gtag).not.toHaveBeenCalled()
  })
})
