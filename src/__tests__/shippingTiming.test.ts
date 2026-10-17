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
  it('combined text mentions all three windows', () => {
    expect(DELIVERY_WINDOWS_TEXT).toContain(SHIPPING_TIMING.metro)
    expect(DELIVERY_WINDOWS_TEXT).toContain(SHIPPING_TIMING.remote)
    expect(DELIVERY_WINDOWS_TEXT).toContain(SHIPPING_TIMING.dispatch)
  })
})
