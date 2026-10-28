/** AUDIT S3-003: cart totals must equal checkout's initial total for the same inputs. */
import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() }, getServiceClient: vi.fn(() => ({ from: vi.fn() })) }))
import { likelyPaymentMethod, cartSubtotal } from '@/components/cart/cartPaymentMethod'
import { calcPriceSummary } from '@/lib/services/pricingService'
import type { CartItem, SiteSettings } from '@/types'

const items = [{ price: 1000, qty: 1, mrp: 1000, gstRate: 5 }] as unknown as CartItem[]
const base = { free_shipping_min: '0', flat_shipping_charge: '99', prepaid_discount_pct: '5', cod_surcharge_amount: '40', cod_max_value: '3000' }

describe('likelyPaymentMethod mirrors useCheckoutPage', () => {
  it('COD disabled (live DEFAULT) + Razorpay on → prepaid pricing, no COD surcharge', () => {
    const s = { ...base, cod_enabled: 'false' } as unknown as SiteSettings
    const m = likelyPaymentMethod(s, cartSubtotal(items), true)
    expect(m).toBe('razorpay')
    const cart = calcPriceSummary(items, s, null, m)
    const checkout = calcPriceSummary(items, s, null, 'razorpay')   // checkout auto-swaps cod → razorpay
    expect(cart.total).toBe(checkout.total)
    expect(cart.codSurcharge).toBe(0)
    expect(cart.prepaidDiscount).toBe(50)
    // the old hard-coded 'cod' pricing disagreed with checkout
    expect(calcPriceSummary(items, s, null, 'cod').total).not.toBe(checkout.total)
  })
  it('COD enabled and under cod_max → COD (checkout default)', () => {
    const s = { ...base, cod_enabled: 'true' } as unknown as SiteSettings
    expect(likelyPaymentMethod(s, 1000, true)).toBe('cod')
  })
  it('COD enabled but over cod_max → razorpay', () => {
    const s = { ...base, cod_enabled: 'true' } as unknown as SiteSettings
    expect(likelyPaymentMethod(s, 3001, true)).toBe('razorpay')
  })
  it('both payment methods off → stays cod (same as checkout, which shows the both-off notice)', () => {
    const s = { ...base, cod_enabled: 'false', upi_enabled: 'false' } as unknown as SiteSettings
    expect(likelyPaymentMethod(s, 1000, true)).toBe('cod')
    expect(likelyPaymentMethod({ ...base, cod_enabled: 'false' } as unknown as SiteSettings, 1000, false)).toBe('cod')
  })
})
