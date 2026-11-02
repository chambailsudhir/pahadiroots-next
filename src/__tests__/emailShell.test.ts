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
  it('works without a button', () => {
    expect(brandedEmail({ heading: 'Hi', bodyHtml: 'x' })).not.toContain('border-radius:24px')
  })
})
