import { describe, it, expect } from 'vitest'
import { emailSafeHtml } from '@/lib/server/emailSafeHtml'
import { brandedEmail } from '@/lib/server/emailShell'

describe('emailSafeHtml (Outlook dropped gradient / shorthand backgrounds: invisible header and button)', () => {
  it('turns a gradient into a solid fallback colour (first stop)', () => {
    const out = emailSafeHtml('<div style="background:linear-gradient(135deg,#1a3a1e,#2d6a4f);padding:1px">x</div>')
    expect(out).toContain('background-color:#1a3a1e')
    expect(out).not.toMatch(/gradient/)
    expect(emailSafeHtml('<a style="background: linear-gradient(#1a5c2a, #2d6a4f);color:#fff">b</a>')).toContain('background-color:#1a5c2a')
  })
  it('turns the plain-colour shorthand into background-color, leaves everything else alone', () => {
    expect(emailSafeHtml('<td style="background:#ffffff;padding:1px">')).toBe('<td style="background-color:#ffffff;padding:1px">')
    expect(emailSafeHtml('<td style="background:#fff">')).toBe('<td style="background-color:#fff">')
    expect(emailSafeHtml('<td style="background-color:#fff;color:#000">')).toBe('<td style="background-color:#fff;color:#000">')
    expect(emailSafeHtml('<td style="background:url(x.png) #fff">')).toBe('<td style="background:url(x.png) #fff">')
  })
})

describe('brandedEmail layout', () => {
  const html = brandedEmail({ heading: 'Welcome, A!', bodyHtml: '<p>hi</p>', cta: { label: 'Verify my email', href: 'https://x.test/a?b=1&c=2' } })
  it('every coloured cell carries bgcolor + background-color (white brand text can never land on the beige page)', () => {
    expect(html).toMatch(/<td align="center" bgcolor="#1a3a1e" style="background-color:#1a3a1e/)
    expect(html).not.toMatch(/background:/)           // no shorthand, no gradient
    expect(html).not.toMatch(/gradient/)
  })
  it('the button is a coloured table cell with the link inside, and the href is escaped', () => {
    expect(html).toMatch(/<td align="center" bgcolor="#2d6a4f"[^>]*><a href="https:\/\/x\.test\/a\?b=1&amp;c=2"/)
    expect(html).toContain('>Verify my email</a>')
  })
})
