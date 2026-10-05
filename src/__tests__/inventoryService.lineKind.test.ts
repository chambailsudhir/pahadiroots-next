/**
 * inventoryService — explicit line kind (Oct 2026 audit).
 * A real variant that shares its product's id (live: product 1 / variant 1) must hit the
 * VARIANT stock functions. The old `variantId === productId` guess sent it to the products row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetServiceClient } = vi.hoisted(() => ({ mockGetServiceClient: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceClient: mockGetServiceClient, supabase: {} }))
vi.mock('@/lib/logger', () => ({ captureError: vi.fn(), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import {
  reserveStockAtomicForOrder, restoreStockReporting, orderItemsToStockItems, isNoVariantItem,
} from '@/lib/services/inventoryService'

let calls: Array<{ name: string; args: Record<string, unknown> }>
beforeEach(() => {
  calls = []
  mockGetServiceClient.mockReturnValue({
    rpc: (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return Promise.resolve({ data: true, error: null }) },
  })
})

describe('isNoVariantItem', () => {
  it('explicit kind wins over id equality', () => {
    expect(isNoVariantItem({ variantId: '1', productId: '1', kind: 'variant' })).toBe(false)
    expect(isNoVariantItem({ variantId: '7', productId: '9', kind: 'product' })).toBe(true)
  })
  it('without a kind it falls back to the legacy equality rule', () => {
    expect(isNoVariantItem({ variantId: '1', productId: '1' })).toBe(true)
    expect(isNoVariantItem({ variantId: '11', productId: '1' })).toBe(false)
    expect(isNoVariantItem({ variantId: '1' })).toBe(false)
  })
})

describe('reserve / restore honour the explicit kind', () => {
  it('reserve: variant 1 of product 1 → reserve_stock_at_order (NOT the products row)', async () => {
    const r = await reserveStockAtomicForOrder([{ variantId: '1', productId: '1', qty: 2, kind: 'variant' }])
    expect(r.ok).toBe(true)
    expect(calls).toEqual([{ name: 'reserve_stock_at_order', args: { p_variant_id: '1', p_qty: 2 } }])
  })

  it('reserve: a genuine bare product still goes to reserve_product_stock_at_order', async () => {
    await reserveStockAtomicForOrder([{ variantId: '99', productId: '99', qty: 1, kind: 'product' }])
    expect(calls).toEqual([{ name: 'reserve_product_stock_at_order', args: { p_product_id: '99', p_qty: 1 } }])
  })

  it('restore: variant 1 of product 1 → restore_stock (NOT the products row)', async () => {
    const { failed } = await restoreStockReporting([{ variantId: '1', productId: '1', qty: 3, kind: 'variant' }])
    expect(failed).toEqual([])
    expect(calls).toEqual([{ name: 'restore_stock', args: { p_variant_id: '1', p_qty: 3 } }])
  })

  it('stored order_items rows (equal ids included) always restore through the variant path', async () => {
    await restoreStockReporting(orderItemsToStockItems([{ product_id: 1, variant_id: 1, quantity: 2 }]))
    expect(calls).toEqual([{ name: 'restore_stock', args: { p_variant_id: '1', p_qty: 2 } }])
  })
})
