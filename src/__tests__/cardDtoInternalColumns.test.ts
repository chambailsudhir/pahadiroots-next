import { describe, it, expect } from 'vitest'
import { toCardProductData } from '@/lib/normalizeProduct'

describe('card DTO (listing pages + public /api/v1/search-catalog)', () => {
  it('does not carry back-office columns no card renders (round-2 audit)', () => {
    const row = {
      id: 1, name: 'Honey', slug: 'honey', price: 499, available_stock: 5, is_active: true,
      sku_backup: 'HNY-OLD-1', hsn_code: '0409', hsn_code_id: 9, initial_stock: 120, video_url: 'https://x/v.mp4',
      cost_price: 200, long_description: 'long', product_variants: [{ id: 1, product_id: 1, price: 499, cost_price: 1 }],
    } as never
    const out = toCardProductData(row) as unknown as Record<string, unknown>
    for (const k of ['sku_backup', 'hsn_code', 'hsn_code_id', 'initial_stock', 'video_url', 'cost_price', 'long_description']) {
      expect(k in out).toBe(false)
    }
    expect(out.name).toBe('Honey')
    expect(out.price).toBe(499)
    expect(out.available_stock).toBe(5)
  })
})
