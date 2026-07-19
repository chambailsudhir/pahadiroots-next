/**
 * emailFooterText.test.ts
 *
 * Covers a fix found while cross-referencing the pahadi-admin repo
 * against the live site: the admin panel's Email settings tab claims
 * "Email Footer Text: Appears at bottom of every outgoing email ✅" —
 * confirmed via grep that lib/server/email.ts never read this setting
 * at all before this fix. Injected centrally in sendTransactionalEmail()
 * itself (not at each of the 4 call sites) so it genuinely applies to
 * every outgoing email, matching what the admin panel claims.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSend = vi.fn()
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: mockSend } }
  }),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceClient: () => ({
    from: () => ({ insert: () => Promise.resolve({ data: null, error: null }) }),
  }),
}))

const mockGetSiteSettings = vi.fn()
vi.mock('@/lib/getSiteSettings', () => ({
  getSiteSettings: () => mockGetSiteSettings(),
}))

const { sendTransactionalEmail } = await import('@/lib/server/email')

describe('sendTransactionalEmail — email footer text', () => {
  beforeEach(() => {
    mockSend.mockReset()
    mockSend.mockResolvedValue({ data: { id: 'email_123' }, error: null })
    mockGetSiteSettings.mockReset()
  })

  it('appends the admin-configured footer text to the sent HTML', async () => {
    mockGetSiteSettings.mockResolvedValue({ email_footer_text: '© 2026 HimVeda by Pahadi Roots. All rights reserved.' })

    await sendTransactionalEmail({
      type: 'order_confirmation', to: 'jane@example.com', subject: 'Order confirmed',
      html: '<p>Your order is confirmed.</p>',
    })

    const sentHtml = mockSend.mock.calls[0][0].html
    expect(sentHtml).toContain('Your order is confirmed.')
    // This is the actual fix: the footer text now appears in the email
    // that's actually sent, not just stored unused in site_settings.
    expect(sentHtml).toContain('© 2026 HimVeda by Pahadi Roots. All rights reserved.')
  })

  it('sends the email unchanged when no footer text is configured', async () => {
    mockGetSiteSettings.mockResolvedValue({ email_footer_text: '' })

    await sendTransactionalEmail({
      type: 'order_confirmation', to: 'jane@example.com', subject: 'Order confirmed',
      html: '<p>Your order is confirmed.</p>',
    })

    expect(mockSend.mock.calls[0][0].html).toBe('<p>Your order is confirmed.</p>')
  })

  it('still sends the email even if fetching settings fails — the footer is a nice-to-have, not a blocker', async () => {
    mockGetSiteSettings.mockRejectedValue(new Error('settings unreachable'))

    const result = await sendTransactionalEmail({
      type: 'order_confirmation', to: 'jane@example.com', subject: 'Order confirmed',
      html: '<p>Your order is confirmed.</p>',
    })

    expect(result.sent).toBe(true)
    expect(mockSend.mock.calls[0][0].html).toBe('<p>Your order is confirmed.</p>')
  })
})
