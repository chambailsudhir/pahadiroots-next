import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { buildAdminOrderEmail, adminOrderEmailSubject, describeOrigin, type AdminOrderEmailInput } from '@/lib/server/adminOrderEmail'

const base: AdminOrderEmailInput = {
  kind: 'cod', orderNumber: 'ORD-2026-00174', placedAt: '2026-11-03T16:49:00Z', status: 'CONFIRMED',
  paymentMethod: 'cod', paymentStatus: 'pending',
  customer: { name: 'Sudhir <b>Chambail</b>', phone: '9717255662', email: 'a@b.com', hasAccount: false, ordersCount: 1 },
  address: { line1: 'C-I/33 Acharya Niketan', line2: 'Mayur Vihar', city: 'New Delhi', state: 'Delhi', pincode: '110091' },
  items: [{ name: 'Himalayan Honey', variant: '500g', sku: 'HON-500', qty: 2, price: 450 }],
  subtotal: 900, couponCode: 'WELCOME50', couponDiscount: 50, coinsRedeemed: 20, shipping: 0, codSurcharge: 40, gstIncluded: 42.86, total: 890,
  origin: 'New Delhi, DL, IN · Mobile (Chrome, Android)', source: 'website',
}

describe('admin order e-mail', () => {
  it('has the customer, address, items, totals, payment and origin', () => {
    const h = buildAdminOrderEmail(base)
    for (const s of ['NEW ORDER · CASH ON DELIVERY', '#ORD-2026-00174', '₹890', 'tel:+919717255662', 'wa.me/919717255662', 'Guest checkout', 'First order',
      'C-I/33 Acharya Niketan', '110091', 'Himalayan Honey', 'SKU HON-500', '× 2', '₹900', 'WELCOME50', '20 coins', 'COD fee', 'Collect on delivery', 'GST included', 'Cash on delivery', 'Chrome, Android', 'What to do']) {
      expect(h).toContain(s)
    }
  })
  it('escapes user-supplied text', () => {
    const h = buildAdminOrderEmail(base)
    expect(h).not.toContain('<b>Chambail</b>')
    expect(h).toContain('&lt;b&gt;Chambail')
  })
  it('paid orders say so and show the payment id', () => {
    const h = buildAdminOrderEmail({ ...base, kind: 'paid', paymentMethod: 'razorpay', paymentStatus: 'paid', paymentId: 'pay_X1', codSurcharge: 0 })
    expect(h).toContain('PAID ONLINE'); expect(h).toContain('pay_X1'); expect(h).toContain('Payment is already received'); expect(h).not.toContain('Collect on delivery')
  })
  it('cancellations show the reason and that stock was restored', () => {
    const h = buildAdminOrderEmail({ ...base, kind: 'cancelled', cancelReason: 'Ordered by mistake', cancelNote: 'sorry' })
    expect(h).toContain('ORDER CANCELLED'); expect(h).toContain('Ordered by mistake'); expect(h).toContain('Stock has been put back')
  })
  it('subject carries the order, total and who/where', () => {
    expect(adminOrderEmailSubject({ kind: 'cod', orderNumber: 'ORD-1', total: 2, customerName: 'Sudhir', city: 'Delhi' })).toBe('New COD order #ORD-1 · ₹2 · Sudhir, Delhi')
  })
  it('origin keeps city and device but no IP', () => {
    const h = new Headers({ 'x-vercel-ip-city': 'New%20Delhi', 'x-vercel-ip-country-region': 'DL', 'x-vercel-ip-country': 'IN', 'x-forwarded-for': '1.2.3.4', 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36' })
    const o = describeOrigin(h)
    expect(o).toBe('New Delhi, DL, IN · Mobile (Chrome, Android)'); expect(o).not.toContain('1.2.3.4')
  })
})
