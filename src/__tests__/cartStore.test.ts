/**
 * cartStore.test.ts
 *
 * Tests for Zustand cart store mutations:
 *   • addItem — new item, duplicate accumulation, qty cap at maxQty
 *   • removeItem
 *   • updateQty — normal update, update to 0 removes item, clamps to maxQty
 *   • applyCoupon / removeCoupon
 *   • clearCart
 *   • cartCount derived value
 *   • idempotencyKey is generated on first addItem and preserved thereafter
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useCartStore } from '@/store/cartStore'
import type { CartItem } from '@/types'

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<CartItem> = {}): Omit<CartItem, 'qty'> {
  return {
    productId:    '1',
    variantId:    'v1',
    name:         'Test Product',
    slug:         'test',
    image:        null,
    emoji:        null,
    size:         '250g',
    price:        200,
    mrp:          250,
    gstRate:      5,
    maxQty:       5,
    isOrganic:    false,
    isHimalayan:  false,
    isBestseller: false,
    ...overrides,
  }
}

// Reset store state before every test so tests are independent.
// Zustand stores are module singletons — we call clearCart between tests.
beforeEach(() => {
  useCartStore.getState().clearCart()
})

// ─── addItem ──────────────────────────────────────────────────────────────────

describe('cartStore.addItem', () => {
  it('adds a new item with qty 1 by default', () => {
    useCartStore.getState().addItem(makeItem())
    const { items } = useCartStore.getState()
    expect(items).toHaveLength(1)
    expect(items[0].qty).toBe(1)
  })

  it('adds a new item with an explicit qty', () => {
    useCartStore.getState().addItem({ ...makeItem(), qty: 3 })
    expect(useCartStore.getState().items[0].qty).toBe(3)
  })

  it('accumulates qty when the same variantId is added again', () => {
    const store = useCartStore.getState()
    store.addItem(makeItem())
    store.addItem(makeItem()) // same variantId
    const items = useCartStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0].qty).toBe(2)
  })

  it('clamps accumulated qty at maxQty — never exceeds stock', () => {
    const store = useCartStore.getState()
    store.addItem({ ...makeItem(), qty: 4 })       // 4/5
    store.addItem({ ...makeItem(), qty: 3 })       // would be 7 — clamped to 5
    const items = useCartStore.getState().items
    expect(items[0].qty).toBe(5)                   // maxQty boundary enforced
  })

  it('adds two different variants as separate line items', () => {
    const store = useCartStore.getState()
    store.addItem(makeItem({ variantId: 'v1' }))
    store.addItem(makeItem({ variantId: 'v2' }))
    expect(useCartStore.getState().items).toHaveLength(2)
  })

  it('generates an idempotencyKey on the first add (if not already set)', () => {
    // clearCart (called in beforeEach) pre-generates a key for the next order,
    // so the key may already be set. The invariant is: after addItem, a non-empty
    // UUID-format key exists and is preserved across subsequent operations.
    useCartStore.getState().addItem(makeItem())
    const key = useCartStore.getState().idempotencyKey
    expect(key).not.toBe('')
    expect(key).toMatch(/^[0-9a-f-]{36}$/) // UUID v4 format
  })

  it('preserves the same idempotencyKey across subsequent adds', () => {
    const store = useCartStore.getState()
    store.addItem(makeItem({ variantId: 'v1' }))
    const key1 = useCartStore.getState().idempotencyKey
    store.addItem(makeItem({ variantId: 'v2' }))
    const key2 = useCartStore.getState().idempotencyKey
    expect(key1).toBe(key2)
  })
})

// ─── removeItem ───────────────────────────────────────────────────────────────

describe('cartStore.removeItem', () => {
  it('removes the matching item by variantId', () => {
    const store = useCartStore.getState()
    store.addItem(makeItem({ variantId: 'v1' }))
    store.addItem(makeItem({ variantId: 'v2' }))
    store.removeItem('v1')
    const items = useCartStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0].variantId).toBe('v2')
  })

  it('is a no-op for an unknown variantId', () => {
    useCartStore.getState().addItem(makeItem())
    useCartStore.getState().removeItem('non-existent')
    expect(useCartStore.getState().items).toHaveLength(1)
  })

  it('empties the cart when the only item is removed', () => {
    const store = useCartStore.getState()
    store.addItem(makeItem())
    store.removeItem('v1')
    expect(useCartStore.getState().items).toHaveLength(0)
  })
})

// ─── updateQty ────────────────────────────────────────────────────────────────

describe('cartStore.updateQty', () => {
  it('updates qty for the matching variantId', () => {
    useCartStore.getState().addItem(makeItem())
    useCartStore.getState().updateQty('v1', 3)
    expect(useCartStore.getState().items[0].qty).toBe(3)
  })

  it('removes the item when qty is updated to 0', () => {
    useCartStore.getState().addItem(makeItem())
    useCartStore.getState().updateQty('v1', 0)
    expect(useCartStore.getState().items).toHaveLength(0)
  })

  it('removes the item when qty is set to a negative number', () => {
    useCartStore.getState().addItem(makeItem())
    useCartStore.getState().updateQty('v1', -1)
    expect(useCartStore.getState().items).toHaveLength(0)
  })

  it('clamps qty at maxQty — never exceeds stock limit', () => {
    useCartStore.getState().addItem(makeItem({ maxQty: 5 }))
    useCartStore.getState().updateQty('v1', 10) // exceeds maxQty=5
    expect(useCartStore.getState().items[0].qty).toBe(5)
  })

  it('leaves other items unchanged when updating one', () => {
    const store = useCartStore.getState()
    store.addItem(makeItem({ variantId: 'v1' }))
    store.addItem(makeItem({ variantId: 'v2' }))
    store.updateQty('v1', 4)
    const v2 = useCartStore.getState().items.find(i => i.variantId === 'v2')
    expect(v2?.qty).toBe(1) // unchanged
  })
})

// ─── coupon ───────────────────────────────────────────────────────────────────

describe('cartStore coupon actions', () => {
  it('applies a coupon', () => {
    useCartStore.getState().applyCoupon({ code: 'SAVE50', discount: 50, type: 'flat' })
    expect(useCartStore.getState().coupon?.code).toBe('SAVE50')
    expect(useCartStore.getState().coupon?.discount).toBe(50)
  })

  it('replaces a previously applied coupon', () => {
    const store = useCartStore.getState()
    store.applyCoupon({ code: 'OLD', discount: 20, type: 'flat' })
    store.applyCoupon({ code: 'NEW', discount: 100, type: 'flat' })
    expect(useCartStore.getState().coupon?.code).toBe('NEW')
  })

  it('removes the coupon', () => {
    useCartStore.getState().applyCoupon({ code: 'X', discount: 10, type: 'flat' })
    useCartStore.getState().removeCoupon()
    expect(useCartStore.getState().coupon).toBeNull()
  })
})

// ─── clearCart ────────────────────────────────────────────────────────────────

describe('cartStore.clearCart', () => {
  it('empties items and removes coupon', () => {
    const store = useCartStore.getState()
    store.addItem(makeItem({ variantId: 'v1' }))
    store.addItem(makeItem({ variantId: 'v2' }))
    store.applyCoupon({ code: 'SALE', discount: 30, type: 'flat' })
    store.clearCart()
    const state = useCartStore.getState()
    expect(state.items).toHaveLength(0)
    expect(state.coupon).toBeNull()
  })

  it('resets idempotencyKey to empty on clear, then lazily generates on next addItem', () => {
    const store = useCartStore.getState()
    store.addItem(makeItem())
    const keyBefore = useCartStore.getState().idempotencyKey
    expect(keyBefore).not.toBe('') // key was generated on addItem

    store.clearCart()
    // clearCart intentionally resets to '' — NOT a new UUID.
    // Eagerly minting a new key here would let a retry on the order-success page
    // pick it up and submit a duplicate order. The '' signals "no pending order".
    expect(useCartStore.getState().idempotencyKey).toBe('')

    // On the next addItem a fresh key is generated lazily — safe moment to do it.
    store.addItem(makeItem())
    const keyAfter = useCartStore.getState().idempotencyKey
    expect(keyAfter).not.toBe('')
    expect(keyAfter).not.toBe(keyBefore)
  })
})

// ─── cartCount ────────────────────────────────────────────────────────────────

describe('cartStore.cartCount', () => {
  it('returns 0 for empty cart', () => {
    expect(useCartStore.getState().cartCount()).toBe(0)
  })

  it('sums total quantity across all items (not unique item count)', () => {
    const store = useCartStore.getState()
    store.addItem({ ...makeItem({ variantId: 'v1' }), qty: 2 })
    store.addItem({ ...makeItem({ variantId: 'v2' }), qty: 3 })
    // 2 + 3 = 5 total units, not 2 unique items
    expect(useCartStore.getState().cartCount()).toBe(5)
  })

  it('reflects qty changes immediately', () => {
    const store = useCartStore.getState()
    store.addItem(makeItem())
    expect(useCartStore.getState().cartCount()).toBe(1)
    store.updateQty('v1', 4)
    expect(useCartStore.getState().cartCount()).toBe(4)
    store.removeItem('v1')
    expect(useCartStore.getState().cartCount()).toBe(0)
  })
})
