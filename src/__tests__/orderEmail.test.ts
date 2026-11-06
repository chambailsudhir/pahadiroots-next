/**
 * The one order-confirmation e-mail (COD + online). Checks content, honesty (coins only for account holders, COD vs paid wording),
 * arithmetic that adds up, and that every dynamic value is escaped.
 */
import { describe, it, expect } from 'vitest'
import { buildOrderEmail, orderEmailSubject, type OrderEmailInput } from '@/lib/server/orderEmail'

const base: OrderEmailInput = {
  kind: 'paid', orderNumber: 'PR1A2B3C4D', customerName: 'Asha Verma', placedAt: '2026-11-02T08:00:00Z',
  items: [
    { name: 'Himalayan Wild Manali Honey', variant: '250g', qty: 2, price: 350, image: 'https://cdn.example.com/honey.jpg' },
    { name: 'Spiti Valley Multiflora', variant: '500g', qty: 1, price: 899, image: null, emoji: '🍯' },
  ],
  subtotal: 1599, couponDiscount: 50, prepaidDiscount: 0, loyaltyDiscount: 0, shipping: 0, codSurcharge: 0, gstIncluded: 76, total: 1549,
  address: { name: 'Asha Verma', line1: '12 Main Road', line2: 'Near Hospital', city: 'Kangra', state: 'Himachal Pradesh', pincode: '176001', phone: '9876543210' },
  paymentId: 'pay_TEST123', deliveryText: 'Metro cities 3–5 business days', trackingText: 'Tracking details are emailed once your order ships.',
}

describe('buildOrderEmail', () => {
  it('online order: itemised lines, price breakdown, address, payment id, track link, delivery text', () => {
    const h = buildOrderEmail(base)
    expect(h).toContain('Payment received. Your order is confirmed.')
    expect(h).toContain('Himalayan Wild Manali Honey')
    expect(h).toContain('Spiti Valley Multiflora')
    expect(h).toContain('Qty 2 × ₹350')
    expect(h).toContain('₹700')            // line total 2 × 350
    expect(h).toContain('Subtotal')
    expect(h).toContain('Coupon discount')
    expect(h).toContain('FREE')            // shipping
    expect(h).toContain('Total paid')
    expect(h).toContain('₹1,549')
    expect(h).toContain('Total includes GST of ₹76')
    expect(h).toContain('12 Main Road')
    expect(h).toContain('Near Hospital')
    expect(h).toContain('Kangra, Himachal Pradesh - 176001')
    expect(h).toContain('pay_TEST123')
    expect(h).toContain('Metro cities 3–5 business days')
    expect(h).toContain('https://www.pahadiroots.com/track?order=PR1A2B3C4D')
    expect(h).toContain('https://cdn.example.com/honey.jpg')
  })

  it('COD order: pay-on-delivery wording, COD fee row, no "paid" claims', () => {
    const h = buildOrderEmail({ ...base, kind: 'cod', paymentId: null, shipping: 99, codSurcharge: 50, total: 1698, couponDiscount: 50 })
    expect(h).toContain('Your order is confirmed.')
    expect(h).not.toContain('Payment received')
    expect(h).toContain('Total to pay on delivery')
    expect(h).toContain('Cash on delivery')
    expect(h).toContain('COD Charges')
    expect(h).toContain('₹99')
    expect(h).not.toContain('Total paid')
  })

  it('Pahadi Coins are mentioned ONLY when coinsEarned is passed (account holders), never for guests', () => {
    expect(buildOrderEmail({ ...base, coinsEarned: 0 })).not.toContain('Pahadi Coins')
    expect(buildOrderEmail(base)).not.toContain('Pahadi Coins')
    expect(buildOrderEmail({ ...base, coinsEarned: 15, signedIn: true })).toContain('You will earn 15 Pahadi Coins')
  })

  it('invoice hint differs: account holders → My Orders, guests → tracking page / WhatsApp', () => {
    expect(buildOrderEmail({ ...base, signedIn: true })).toContain('under <a href="https://www.pahadiroots.com/account?tab=orders"')
    expect(buildOrderEmail({ ...base, signedIn: false })).toContain('Need a GST invoice?')
  })

  it('shows prepaid and coin savings as their own lines', () => {
    const h = buildOrderEmail({ ...base, prepaidDiscount: 40, loyaltyDiscount: 20 })
    expect(h).toContain('Prepaid discount')
    expect(h).toContain('Pahadi Coins redeemed')
  })

  it('escapes every dynamic value (names, items, address, order number)', () => {
    const evil = '<script>alert(1)</script>'
    const h = buildOrderEmail({
      ...base, customerName: evil, orderNumber: 'PR<b>X', items: [{ name: evil, variant: evil, qty: 1, price: 10, image: 'javascript:alert(1)' }],
      address: { name: evil, line1: evil, city: evil, state: evil, pincode: evil, phone: evil }, paymentId: evil,
    })
    expect(h).not.toContain('<script>alert(1)</script>')
    expect(h).not.toContain('javascript:alert')
    expect(h).toContain('&lt;script&gt;')
  })

  it('only embeds https (or site-relative) product images', () => {
    const h = buildOrderEmail({ ...base, items: [{ name: 'A', qty: 1, price: 1, image: 'http://insecure.example.com/a.jpg' }, { name: 'B', qty: 1, price: 1, image: '/uploads/b.jpg' }] })
    expect(h).not.toContain('insecure.example.com')
    expect(h).toContain('https://www.pahadiroots.com/uploads/b.jpg')
  })

  // Nov 2026 (finding B): Outlook desktop ignores padding / background on an inline <a>, so a CTA that is only a styled anchor is
  // white text on a white card there. Every CTA must be a "bulletproof" button: a <td> with bgcolor + background-color holding the link.
  it('every CTA is a table-cell button (bgcolor + background-color on the <td>), never a bare styled <a> — Outlook-safe', () => {
    const h = buildOrderEmail(base)
    for (const cta of ['Track your order', 'Chat on WhatsApp']) {
      const i = h.indexOf(`>${cta}</a>`)
      expect(i).toBeGreaterThan(0)
      const before = h.slice(Math.max(0, i - 700), i)
      const td = before.lastIndexOf('<td ')
      expect(td).toBeGreaterThan(before.lastIndexOf('</td>'))                    // the <a> is inside a <td>
      expect(before.slice(td)).toMatch(/^<td align="center" bgcolor="#[0-9a-f]{6}" style="background-color:#[0-9a-f]{6};/)
    }
    // no anchor anywhere carries its own padding + background (the pattern Outlook drops) or the background shorthand
    for (const a of h.match(/<a [^>]*>/g) ?? []) {
      expect(a).not.toMatch(/background:/)
      if (/padding:/.test(a)) expect(a).toMatch(/background-color:#[0-9a-f]{6}/)
    }
  })

  it('the round step markers and the tick disc are table cells with bgcolor + fixed width/height (squares in Outlook, never missing)', () => {
    const h = buildOrderEmail(base)
    expect(h).not.toMatch(/<div style="[^"]*border-radius:50%/)
    expect(h).toMatch(/<td width="56" height="56" align="center" valign="middle" bgcolor="#e6f2e8" style="width:56px;height:56px;[^"]*background-color:#e6f2e8/)
    expect((h.match(/<td width="26" height="26" align="center" valign="middle" bgcolor="#(1a3a1e|ece5d8)"/g) ?? []).length).toBe(4)
  })

  it('subject lines', () => {
    expect(orderEmailSubject('paid', 'PR1')).toMatch(/Payment received.*PR1/)
    expect(orderEmailSubject('cod', 'PR1')).toMatch(/Order confirmed.*PR1/)
  })

  it('prices with paise: Subtotal = sum of lines, explicit Round off row, two decimals (real production case ₹266.67 → ₹267)', () => {
    const h = buildOrderEmail({ ...base, items: [{ name: 'Honey', qty: 1, price: 266.67 }], subtotal: 267, couponDiscount: 0, shipping: 0, total: 267, gstIncluded: 12.7 })
    expect(h).toContain('₹266.67')
    expect(h).toContain('Round off')
    expect(h).toContain('+₹0.33')
    expect(h).toContain('₹267')
  })

  it('a gap of ₹1 or more is not shown as rounding', () => {
    const h = buildOrderEmail({ ...base, items: [{ name: 'Honey', qty: 1, price: 100 }], subtotal: 105, couponDiscount: 0, shipping: 0, total: 105 })
    expect(h).not.toContain('Round off')
    expect(h).toContain('₹105')
  })
})
