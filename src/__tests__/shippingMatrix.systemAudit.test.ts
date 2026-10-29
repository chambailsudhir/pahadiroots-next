/**
 * shippingMatrix.systemAudit.test.ts — System audit (Oct 2026), the shipping cases that had no test:
 * malformed / negative / empty settings values, a zero flat fee, the interaction of a coupon at the threshold, delivery-state
 * names exactly as checkout produces them, invalid and blocked PINs — and the contract with the admin Settings page, which
 * now normalises "Jammu and Kashmir" to "Jammu & Kashmir" before saving.
 * (Below / at / above the threshold, coupon-before-shipping, zero threshold and loyalty ordering are in pricingService.test.ts
 * and pricingInvariants.test.ts.)
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() }, getServiceClient: vi.fn(() => ({ from: vi.fn() })) }))
import { calcPriceSummary } from '@/lib/services/pricingService'
import { checkServiceability, parseBlockedPincodes } from '@/lib/serviceability'
import { INDIA_STATES } from '@/lib/account/constants'
import type { CartItem, SiteSettings } from '@/types'

const item = (price: number, qty = 1): CartItem => ({
  productId: '1', variantId: 'v1', name: 'P', slug: 'p', image: null, emoji: null, size: '250g',
  price, mrp: price, gstRate: 5, qty, maxQty: 10, isOrganic: false, isHimalayan: false, isBestseller: false,
})
const cfg = (o: Record<string, string>) => ({ prepaid_discount_pct: '0', cod_surcharge_amount: '0', ...o }) as unknown as SiteSettings
const ship = (o: Record<string, string>, subtotal = 500) => calcPriceSummary([item(subtotal)], cfg(o), null, 'cod')

describe('malformed or hostile configuration values never produce a surprising price', () => {
  it('free_shipping_min: negative → treated as 0 (everyone ships free); text or empty → the documented fallback (0), not NaN', () => {
    for (const v of ['-100', '-0.5']) expect(ship({ free_shipping_min: v, flat_shipping_charge: '99' }).shipping, v).toBe(0)
    for (const v of ['abc', '', '   ', 'null', 'NaN', '₹799']) {
      const s = ship({ free_shipping_min: v, flat_shipping_charge: '99' });
      expect(Number.isFinite(s.total), v).toBe(true)
      expect(s.freeShippingMin, v).toBe(0)
      expect(s.shipping, v).toBe(0)
    }
  })
  it('flat_shipping_charge: negative is clamped to 0 (a negative fee would REDUCE the total); text/empty → the ₹99 fallback', () => {
    expect(ship({ free_shipping_min: '1000', flat_shipping_charge: '-50' }).shipping).toBe(0);
    expect(ship({ free_shipping_min: '1000', flat_shipping_charge: '-50' }).total).toBe(500);
    for (const v of ['abc', '', '  ']) expect(ship({ free_shipping_min: '1000', flat_shipping_charge: v }).shipping, v).toBe(99)
  })
  it('a zero flat fee below the threshold charges nothing (total = goods) — and the total is still an integer', () => {
    const s = ship({ free_shipping_min: '1000', flat_shipping_charge: '0' })
    expect(s.shipping).toBe(0); expect(s.total).toBe(500); expect(Number.isInteger(s.total)).toBe(true)
  })
  it('decimal thresholds and fees are honoured exactly (₹499.50 threshold: 499 pays, 500 ships free)', () => {
    expect(ship({ free_shipping_min: '499.5', flat_shipping_charge: '99' }, 499).shipping).toBe(99)
    expect(ship({ free_shipping_min: '499.5', flat_shipping_charge: '99' }, 500).shipping).toBe(0)
  })
  it('a coupon that drops the cart exactly to the threshold keeps free shipping; one rupee more takes it away (the rule is stated on the payable goods value)', () => {
    const at = (disc: number) => calcPriceSummary([item(800)], cfg({ free_shipping_min: '500', flat_shipping_charge: '99' }), { code: 'X', discount: disc, type: 'flat' }, 'cod')
    expect(at(300).shipping).toBe(0); expect(at(300).total).toBe(500)
    expect(at(301).shipping).toBe(99); expect(at(301).total).toBe(499 + 99)
  })
  it('a client can only send items, address, payment method and coupon — shipping is always recomputed from the settings', () => {
    // calcPriceSummary has no input for a client-supplied shipping amount at all; a "free shipping" tamper has nothing to attach to.
    const s = calcPriceSummary([item(100)], cfg({ free_shipping_min: '500', flat_shipping_charge: '99' }), null, 'cod')
    expect(s.shipping).toBe(99)
    expect(Object.keys(s)).not.toContain('clientShipping')
  })
})

describe('delivery rules use the exact state names the checkout form produces', () => {
  it('every canonical state name, saved on its own, serves that state (any case / spacing) and refuses another', () => {
    for (const state of INDIA_STATES) {
      const settings = { serviceable_states: state }
      expect(checkServiceability({ state, pincode: '176082' }, settings).ok, state).toBe(true)
      expect(checkServiceability({ state: `  ${state.toUpperCase()}  `, pincode: '176082' }, settings).ok, state + ' upper').toBe(true)
      const other = INDIA_STATES.find(s => s !== state)!
      expect(checkServiceability({ state: other, pincode: '176082' }, settings).ok, state + ' vs ' + other).toBe(false)
    }
  })
  it('the admin saves "Jammu & Kashmir" (not "Jammu and Kashmir"): that exact stored text serves a customer who chose Jammu & Kashmir; the raw "and" spelling would have refused them', () => {
    expect(checkServiceability({ state: 'Jammu & Kashmir', pincode: '190001' }, { serviceable_states: 'Jammu & Kashmir, Ladakh' }).ok).toBe(true)
    expect(checkServiceability({ state: 'Jammu & Kashmir', pincode: '190001' }, { serviceable_states: 'Jammu and Kashmir' }).ok).toBe(false)   // the failure the admin validation now prevents
  })
  it('a restricted state is refused with a message that names it', () => {
    const r = checkServiceability({ state: 'Kerala', pincode: '682001' }, { serviceable_states: 'Himachal Pradesh, Uttarakhand' })
    expect(r).toEqual({ ok: false, reason: 'Sorry, we do not deliver to Kerala yet.' })
  })
  it('blocked PINs: exact and prefix; the PIN is named in the refusal; an unlisted PIN is served', () => {
    const s = { blocked_pincodes: '193, 110001' }
    expect(checkServiceability({ state: 'Delhi', pincode: '110001' }, s)).toEqual({ ok: false, reason: 'Sorry, we do not deliver to PIN code 110001 yet.' })
    expect(checkServiceability({ state: 'Jammu & Kashmir', pincode: '193101' }, s).ok).toBe(false)
    expect(checkServiceability({ state: 'Delhi', pincode: '110002' }, s).ok).toBe(true)
  })
  it('invalid or missing PINs are not "blocked" by an empty list; malformed list entries are dropped (which is why the admin now rejects them instead)', () => {
    expect(checkServiceability({ state: 'Delhi', pincode: 'abc' }, { blocked_pincodes: '' }).ok).toBe(true)
    expect(checkServiceability({ state: 'Delhi', pincode: '' }, { blocked_pincodes: '110' }).ok).toBe(true)
    expect(parseBlockedPincodes('1930001, 19, abc, 193')).toEqual(['193'])    // 3 of 4 entries silently ignored — admin validation exists to make that impossible
  })
  it('empty-list semantics: neither rule set = all of India', () => {
    expect(checkServiceability({ state: 'Kerala', pincode: '682001' }, {}).ok).toBe(true)
    expect(checkServiceability({ state: 'Kerala', pincode: '682001' }, { serviceable_states: '', blocked_pincodes: '' }).ok).toBe(true)
  })
})
