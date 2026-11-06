import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { brandedEmail, brandHeaderRow } from '@/lib/server/emailShell'
import { buildOrderEmail } from '@/lib/server/orderEmail'

// The owner-approved logo (HimVeda + leaf, "by Pahadi Roots") must head EVERY customer e-mail, from one definition.
describe('e-mail brand header', () => {
  const header = brandHeaderRow()
  it('is the real logo image with styled alt text and the tagline, on a LIGHT band (the logo is dark green on transparent)', () => {
    expect(header).toMatch(/<img src="https:\/\/www\.pahadiroots\.com\/email-logo\.png"[^>]*alt="HimVeda by Pahadi Roots"/)
    expect(header).toContain('Pure Himalayan &middot; Natural &middot; Authentic')
    expect(header).toMatch(/bgcolor="#fffdf9"/)
    expect(header).not.toMatch(/gradient|🌿/)
  })
  it('the logo file exists, is small enough for an e-mail and is a PNG', () => {
    expect(existsSync('public/email-logo.png')).toBe(true)
    const b = readFileSync('public/email-logo.png')
    expect(b.subarray(1, 4).toString()).toBe('PNG')
    expect(b.length).toBeLessThan(120_000)
  })
  it('the shared shell (sign-up, reset, cancel, review, deletion) and the order e-mail use that same header', () => {
    expect(brandedEmail({ heading: 'x', bodyHtml: '<p>y</p>' })).toContain(header)
    const order = buildOrderEmail({
      orderNumber: 'ORD-1', createdAt: new Date().toISOString(), customerName: 'A', paymentMethod: 'cod',
      subtotal: 100, shipping: 0, total: 100, items: [{ name: 'P', qty: 1, price: 100 }],
      address: { name: 'A', phone: '9000000000', flat: '1', area: 'x', city: 'c', state: 's', pincode: '248001' },
    } as never)
    expect(order).toContain(header)
  })
  it('the order e-mail no longer carries the "changed your mind" returns bullet', () => {
    const order = buildOrderEmail({
      orderNumber: 'ORD-1', createdAt: new Date().toISOString(), customerName: 'A', paymentMethod: 'cod',
      subtotal: 100, shipping: 0, total: 100, items: [{ name: 'P', qty: 1, price: 100 }],
      address: { name: 'A', phone: '9000000000', flat: '1', area: 'x', city: 'c', state: 's', pincode: '248001' },
    } as never)
    expect(order).not.toMatch(/Changed your mind/i)
  })
})

// Nov 2026 (finding J): the admin repo (pahadi-admin src/lib/statusEmail.js brandHeaderHtml) carries a copy of this header because two
// repos cannot share code. These are the canonical fragments BOTH copies must contain; change them here and in the admin together.
describe('e-mail brand header — canonical fragments (cross-repo drift guard)', () => {
  const header = brandHeaderRow()
  it.each([
    'https://www.pahadiroots.com/email-logo.png',
    'width="240" height="90" alt="HimVeda by Pahadi Roots"',
    'bgcolor="#fffdf9" style="background-color:#fffdf9;border-radius:18px 18px 0 0;padding:22px 28px 14px;border-bottom:3px solid #c8962a"',
    'Pure Himalayan &middot; Natural &middot; Authentic',
    'font-size:10px;letter-spacing:3px;color:#1a3a1e;margin-top:8px;text-transform:uppercase',
  ])('contains %s', (fragment) => {
    expect(header).toContain(fragment)
  })
  it('links the logo to the canonical https origin', () => {
    expect(header).toMatch(/<a href="https:\/\/www\.pahadiroots\.com" target="_blank"/)
  })
})
