import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SHIPPING_TIMING, DELIVERY_WINDOWS_TEXT } from '@/lib/shippingCopy'

// Guards PDP audit P1-6: the PDP / PIN checker must quote the SAME windows as the Shipping Policy page.
describe('shipping timing stays in sync with the Shipping Policy page', () => {
  const policy = readFileSync(join(__dirname, '../app/policies/[type]/page.tsx'), 'utf8')
  const norm = (s: string) => s.replace(/[\u2013\u2014-]/g, '-')
  it('policy page states the same dispatch / metro / remote windows', () => {
    expect(norm(policy)).toContain(norm(`'Within ${SHIPPING_TIMING.dispatch}'`))
    expect(norm(policy)).toContain(norm(`'${SHIPPING_TIMING.metro} after dispatch'`))
    expect(norm(policy)).toContain(norm(`'${SHIPPING_TIMING.remote} after dispatch'`))
  })
  // AUDIT S3-001: no surface may carry its own delivery / returns / WhatsApp-notification promise.
  const SURFACES = [
    '../app/cart/page.tsx', '../app/checkout/CheckoutClient.tsx', '../app/contact/page.tsx',
    '../components/checkout/OrderSummary.tsx', '../lib/account/utils.ts', '../app/order-success/page.tsx',
    '../app/account/_sections/OrdersSection.tsx', '../lib/pincodeZones.ts', '../app/account/_sections/NotificationsSection.tsx',
  ]
  it('cart / checkout / contact / account / order-success carry no hand-typed delivery windows or ETA maths', () => {
    for (const f of SURFACES) {
      const src = norm(readFileSync(join(__dirname, f), 'utf8'))
      expect(src, f).not.toMatch(/\b(3-5|2-4|4-6|5-8) ?(Day|business day|days)/i)
      expect(src, f).not.toMatch(/setDate\(/)
      expect(src, f).not.toMatch(/today's dispatch|tomorrow's dispatch/)
    }
  })
  it('no surface promises WhatsApp / SMS notifications (email is the only sender)', () => {
    for (const f of SURFACES) {
      const src = readFileSync(join(__dirname, f), 'utf8')
      expect(src, f).not.toMatch(/(shared|updates|tracking[^\n]{0,40}) (on|via) WhatsApp/i)
      expect(src, f).not.toMatch(/notif_whatsapp_orders|notif_sms_orders/)
    }
  })
  it('combined text mentions all three windows', () => {
    expect(DELIVERY_WINDOWS_TEXT).toContain(SHIPPING_TIMING.metro)
    expect(DELIVERY_WINDOWS_TEXT).toContain(SHIPPING_TIMING.remote)
    expect(DELIVERY_WINDOWS_TEXT).toContain(SHIPPING_TIMING.dispatch)
  })
})
