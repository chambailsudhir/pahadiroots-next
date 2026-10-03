/**
 * privateFields.test.ts — internal columns (cost, margin, supplier, pricing-engine
 * bookkeeping, warehouse counters) must never reach client-bound product data.
 * Regression for the Oct 2026 audit finding: every PDP serialized the full
 * `products` row (incl. cost_price) into the page payload.
 */
import { describe, it, expect } from 'vitest'
import {
  PRIVATE_PRODUCT_FIELDS, PRIVATE_VARIANT_FIELDS, scrubProduct, scrubVariant,
} from '@/lib/privateFields'
import { toCardProductData } from '@/lib/normalizeProduct'

const fullProduct = () => ({
  id: 1, name: 'Honey', slug: 'honey', price: 500, selling_price: 500, mrp: 600, sku_backup: 'HNY-1',
  cost_price: 210.5, vendor_id: 7, psy_sp_raw: 497.3, psy_mrp_raw: 601.2, price_version: 12,
  engine_version_at_save: 'v9', last_repriced_at: '2026-09-01T00:00:00Z', ai_provider: 'gemini', orders_reserved: 3,
  product_variants: [
    { id: 11, price: 500, variant_value: '500g', available_stock: 9, is_active: true,
      cost_price: 200, margin_pct: 40, reserved_stock: 1, damaged_stock: 2, blocked_stock: 0, orders_reserved: 1, barcode: '890123' },
  ],
})

describe('scrubProduct / scrubVariant', () => {
  it('nulls every private product field and every private field of nested variants', () => {
    const out: any = scrubProduct(fullProduct())
    for (const f of PRIVATE_PRODUCT_FIELDS) expect(out[f], f).toBeNull()
    for (const f of PRIVATE_VARIANT_FIELDS) expect(out.product_variants[0][f], f).toBeNull()
  })

  it('keeps everything a customer needs untouched', () => {
    const out: any = scrubProduct(fullProduct())
    expect(out).toMatchObject({ id: 1, name: 'Honey', slug: 'honey', price: 500, selling_price: 500, mrp: 600, sku_backup: 'HNY-1' })
    expect(out.product_variants[0]).toMatchObject({ id: 11, price: 500, variant_value: '500g', available_stock: 9, is_active: true })
  })

  it('does not mutate its input and does not invent keys that were never selected', () => {
    const input = fullProduct()
    const snapshot = JSON.stringify(input)
    scrubProduct(input)
    expect(JSON.stringify(input)).toBe(snapshot)
    const sparse: any = scrubProduct({ id: 2, name: 'Ghee' })
    expect('cost_price' in sparse).toBe(false)
    expect(scrubVariant({ id: 1, price: 10 })).toEqual({ id: 1, price: 10 })
  })

  it('toCardProductData (the client-bound card payload) is scrubbed too', () => {
    const out: any = toCardProductData(fullProduct() as any)
    expect(out.cost_price).toBeNull()
    expect(out.vendor_id).toBeNull()
    expect(out.product_variants[0].cost_price).toBeNull()
    expect(out.product_variants[0].margin_pct).toBeNull()
  })

  it('serialized card JSON contains none of the private values', () => {
    const json = JSON.stringify(toCardProductData(fullProduct() as any))
    for (const secret of ['210.5', '497.3', '601.2', 'gemini', '890123']) expect(json).not.toContain(secret)
  })
})
