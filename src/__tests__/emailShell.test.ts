import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { brandedEmail, SUPPORT_WHATSAPP_URL } from '@/lib/server/emailShell'

describe('brandedEmail', () => {
  const html = brandedEmail({ heading: 'Your order has been cancelled', bodyHtml: '<p>Body</p>', cta: { label: 'Continue shopping', href: 'https://www.pahadiroots.com' } })
  it('is a complete HTML document with the brand header, the body, a button and the support footer', () => {
    expect(html).toMatch(/^<!DOCTYPE html>/)
    expect(html).toContain('HimVeda by Pahadi Roots')
    expect(html).toContain('<p>Body</p>')
    expect(html).toContain('Continue shopping')
    expect(html).toContain(SUPPORT_WHATSAPP_URL)
    expect(html).toContain('pahadiroots.com')
  })
  it('escapes the heading and the button label / link (callers only pre-escape the body)', () => {
    const h = brandedEmail({ heading: '<script>x</script>', bodyHtml: '', cta: { label: '"><img onerror=x>', href: 'javascript:"x' } })
    expect(h).not.toContain('<script>')
    expect(h).not.toContain('<img onerror')
    expect(h).toContain('&lt;script&gt;')
  })
  // Nov 2026 (finding F): the button is only rendered for an https link — a javascript:/http:/relative/empty href drops it.
  it('renders the button only for an https href; anything else drops the button (never a javascript: or http: link in a mail)', () => {
    const body = (href: string) => brandedEmail({ heading: 'Hi', bodyHtml: 'x', cta: { label: 'Go', href } })
    expect(body('https://www.pahadiroots.com/track?order=1')).toContain('>Go</a>')
    for (const bad of ['javascript:alert(1)', 'http://www.pahadiroots.com/x', '/account', '', 'HTTPS//x', 'data:text/html,x']) {
      const h = body(bad)
      expect(h).not.toContain('>Go</a>')
      expect(h).not.toContain('border-radius:24px')
      expect(h).not.toMatch(/href="(javascript|data|http):/)
    }
    expect(body('HTTPS://x.test/ok')).toContain('>Go</a>')   // scheme compare is case-insensitive
  })
  it('works without a button', () => {
    expect(brandedEmail({ heading: 'Hi', bodyHtml: 'x' })).not.toContain('border-radius:24px')
  })
})
