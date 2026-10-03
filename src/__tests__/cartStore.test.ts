/**
 * cartStore.test.ts
 *
 * Tests for Zustand cart store mutations:
 *   • addItem — new item, duplicate accumulation, qty cap at maxQty
 *   • removeItem
 *   • updateQty — normal update, update to 0 removes item, clamps to maxQty
 *   • applyCoupon / removeCoupon — including lastAppliedCouponCode persistence
 *   • clearCart
 *   • cartCount derived value
 *   • idempotencyKey lifecycle: lazy generation, preserve across adds, reset on clear
 *   • resetIdempotencyKey / ensureIdempotencyKey helpers
 *   • selectCartCount stable selector
 *   • persist partialize — maxQty is stripped, coupon is excluded
 *   • migrate — v1→v3 and v2→v3 upgrade paths
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useCartStore, selectCartCount, selectHasHydrated } from '@/store/cartStore'
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

  it('uses maxQty from existing item when accumulating (not newItem.maxQty)', () => {
    // First add sets maxQty=3, second add tries maxQty=10 — cap must stay 3
    const store = useCartStore.getState()
    store.addItem(makeItem({ variantId: 'v1', maxQty: 3 }))
    store.addItem({ ...makeItem({ variantId: 'v1', maxQty: 10 }), qty: 5 })
    expect(useCartStore.getState().items[0].qty).toBe(3) // capped at original maxQty
  })

  it('falls back to 99 cap when existing item has no maxQty (stripped by persist)', () => {
    // Simulate a hydrated item without maxQty
    useCartStore.setState({
      items: [{ ...makeItem(), qty: 1, maxQty: undefined as unknown as number }],
    })
    // Adding more should not crash — caps at 99
    useCartStore.getState().addItem({ ...makeItem(), qty: 50 })
    const qty = useCartStore.getState().items[0].qty
    expect(qty).toBeGreaterThan(1)
    expect(qty).toBeLessThanOrEqual(99)
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

  // BUG FIX regression test: removeItem must reset idempotencyKey when it
  // empties the cart, exactly like clearCart does. Otherwise a stale key
  // generated for a previous (now-removed) cart contents would be reused
  // for a completely different set of items on the next addItem — a
  // payment-integrity hazard if the server has any record tied to that key.
  it('resets idempotencyKey to empty when removeItem empties the cart', () => {
    const store = useCartStore.getState()
    store.addItem(makeItem({ variantId: 'v1' }))
    expect(useCartStore.getState().idempotencyKey).not.toBe('')

    store.removeItem('v1')
    expect(useCartStore.getState().items).toHaveLength(0)
    expect(useCartStore.getState().idempotencyKey).toBe('')

    // A subsequent add for *different* items gets a fresh key, never the old one.
    const oldKey = useCartStore.getState().idempotencyKey
    store.addItem(makeItem({ variantId: 'v2' }))
    const newKey = useCartStore.getState().idempotencyKey
    expect(newKey).not.toBe('')
    expect(newKey).not.toBe(oldKey)
  })

  // updateQty(qty<=0) delegates to removeItem — same guarantee must hold.
  it('resets idempotencyKey to empty when updateQty(0) empties the cart', () => {
    const store = useCartStore.getState()
    store.addItem(makeItem({ variantId: 'v1' }))
    expect(useCartStore.getState().idempotencyKey).not.toBe('')

    store.updateQty('v1', 0)
    expect(useCartStore.getState().items).toHaveLength(0)
    expect(useCartStore.getState().idempotencyKey).toBe('')
  })

  // Removing one of several items must NOT reset the key — the remaining
  // cart contents are still covered by the existing idempotency window.
  it('preserves idempotencyKey when removeItem leaves items behind', () => {
    const store = useCartStore.getState()
    store.addItem(makeItem({ variantId: 'v1' }))
    store.addItem(makeItem({ variantId: 'v2' }))
    const keyBefore = useCartStore.getState().idempotencyKey

    store.removeItem('v1')
    expect(useCartStore.getState().items).toHaveLength(1)
    expect(useCartStore.getState().idempotencyKey).toBe(keyBefore)
  })

  // DATA INTEGRITY BUG FIX: removeItem emptying the cart must clear `coupon`
  // and `lastAppliedCouponCode` — same guarantee as clearCart(). Otherwise a
  // coupon's frozen `discount` (validated against the now-gone cart's
  // subtotal) survives onto whatever the user adds to the cart next.
  it('clears coupon and lastAppliedCouponCode when removeItem empties the cart', () => {
    const store = useCartStore.getState()
    store.addItem(makeItem({ variantId: 'v1' }))
    store.applyCoupon({ code: 'PAHADI10', discount: 100, type: 'flat' })

    store.removeItem('v1')

    const state = useCartStore.getState()
    expect(state.items).toHaveLength(0)
    expect(state.coupon).toBeNull()
    expect(state.lastAppliedCouponCode).toBe('')
  })

  // updateQty(0) delegates to removeItem — same coupon-clearing guarantee
  // must hold for that path too.
  it('clears coupon when updateQty(0) empties the cart', () => {
    const store = useCartStore.getState()
    store.addItem(makeItem({ variantId: 'v1' }))
    store.applyCoupon({ code: 'PAHADI10', discount: 100, type: 'flat' })

    store.updateQty('v1', 0)

    const state = useCartStore.getState()
    expect(state.items).toHaveLength(0)
    expect(state.coupon).toBeNull()
    expect(state.lastAppliedCouponCode).toBe('')
  })

  // Removing one of several items must NOT clear the coupon — it's still
  // valid for the remaining cart contents (subject to the /cart page's
  // revalidation effect re-checking min_order etc. against the new subtotal).
  it('preserves coupon when removeItem leaves items behind', () => {
    const store = useCartStore.getState()
    store.addItem(makeItem({ variantId: 'v1' }))
    store.addItem(makeItem({ variantId: 'v2' }))
    store.applyCoupon({ code: 'PAHADI10', discount: 100, type: 'flat' })

    store.removeItem('v1')

    const state = useCartStore.getState()
    expect(state.items).toHaveLength(1)
    expect(state.coupon?.code).toBe('PAHADI10')
    expect(state.lastAppliedCouponCode).toBe('PAHADI10')
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

  it('is a no-op for an unknown variantId', () => {
    useCartStore.getState().addItem(makeItem())
    useCartStore.getState().updateQty('non-existent', 3)
    expect(useCartStore.getState().items).toHaveLength(1)
    expect(useCartStore.getState().items[0].qty).toBe(1)
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

  it('sets lastAppliedCouponCode when a coupon is applied', () => {
    useCartStore.getState().applyCoupon({ code: 'PAHADI10', discount: 100, type: 'flat' })
    expect(useCartStore.getState().lastAppliedCouponCode).toBe('PAHADI10')
  })

  it('clears lastAppliedCouponCode when coupon is removed', () => {
    useCartStore.getState().applyCoupon({ code: 'PAHADI10', discount: 100, type: 'flat' })
    useCartStore.getState().removeCoupon()
    expect(useCartStore.getState().lastAppliedCouponCode).toBe('')
  })

  it('coupon object is null after clearCart but lastAppliedCouponCode is also cleared', () => {
    useCartStore.getState().applyCoupon({ code: 'SAVE', discount: 50, type: 'flat' })
    useCartStore.getState().clearCart()
    expect(useCartStore.getState().coupon).toBeNull()
    expect(useCartStore.getState().lastAppliedCouponCode).toBe('')
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

// ─── selectCartCount ─────────────────────────────────────────────────────────

describe('selectCartCount (stable selector)', () => {
  it('returns 0 for empty cart', () => {
    expect(selectCartCount(useCartStore.getState())).toBe(0)
  })

  it('sums quantities across all items — matches cartCount()', () => {
    const store = useCartStore.getState()
    store.addItem({ ...makeItem({ variantId: 'v1' }), qty: 2 })
    store.addItem({ ...makeItem({ variantId: 'v2' }), qty: 3 })
    const state = useCartStore.getState()
    expect(selectCartCount(state)).toBe(state.cartCount())
    expect(selectCartCount(state)).toBe(5)
  })

  it('works with a plain items array directly (no store required)', () => {
    const items: CartItem[] = [
      { ...makeItem({ variantId: 'v1' }), qty: 1 },
      { ...makeItem({ variantId: 'v2' }), qty: 4 },
    ]
    expect(selectCartCount({ items })).toBe(5)
  })
})

// ─── resetIdempotencyKey ──────────────────────────────────────────────────────

describe('cartStore.resetIdempotencyKey', () => {
  it('generates a new UUID regardless of existing key', () => {
    useCartStore.getState().addItem(makeItem())
    const before = useCartStore.getState().idempotencyKey
    useCartStore.getState().resetIdempotencyKey()
    const after = useCartStore.getState().idempotencyKey
    expect(after).not.toBe('')
    expect(after).not.toBe(before) // genuinely new key
    expect(after).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('works even when key is empty (fresh cart)', () => {
    // clearCart sets idempotencyKey to ''
    expect(useCartStore.getState().idempotencyKey).toBe('')
    useCartStore.getState().resetIdempotencyKey()
    const key = useCartStore.getState().idempotencyKey
    expect(key).not.toBe('')
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
  })
})

// ─── ensureIdempotencyKey ─────────────────────────────────────────────────────

describe('cartStore.ensureIdempotencyKey', () => {
  it('returns the existing key when one is already set', () => {
    useCartStore.getState().addItem(makeItem())
    const existing = useCartStore.getState().idempotencyKey
    const returned = useCartStore.getState().ensureIdempotencyKey()
    expect(returned).toBe(existing)
    // Store must not have changed
    expect(useCartStore.getState().idempotencyKey).toBe(existing)
  })

  it('generates, stores, and returns a new key when key is empty', () => {
    // clearCart sets idempotencyKey to ''
    expect(useCartStore.getState().idempotencyKey).toBe('')
    const returned = useCartStore.getState().ensureIdempotencyKey()
    expect(returned).not.toBe('')
    expect(returned).toMatch(/^[0-9a-f-]{36}$/)
    // Must be persisted to store too
    expect(useCartStore.getState().idempotencyKey).toBe(returned)
  })

  it('is idempotent — calling twice returns the same key', () => {
    const first  = useCartStore.getState().ensureIdempotencyKey()
    const second = useCartStore.getState().ensureIdempotencyKey()
    expect(first).toBe(second)
  })
})

// ─── persist partialize ───────────────────────────────────────────────────────

describe('cartStore persist — partialize', () => {
  it('strips maxQty from persisted items (security: prevents localStorage stock tampering)', () => {
    useCartStore.getState().addItem(makeItem({ variantId: 'v1', maxQty: 5 }))
    const state = useCartStore.getState()
    // Access partialize directly by calling it with the current state
    const partializer = useCartStore.persist?.getOptions?.()?.partialize
    if (!partializer) return // skip if internal API changed

    const persisted = partializer(state) as { items: Array<Record<string, unknown>> }
    expect(persisted.items[0]).not.toHaveProperty('maxQty')
  })

  it('coupon is not part of persisted state — session-only', () => {
    useCartStore.getState().addItem(makeItem())
    useCartStore.getState().applyCoupon({ code: 'TEST', discount: 50, type: 'flat' })
    const state = useCartStore.getState()
    const partializer = useCartStore.persist?.getOptions?.()?.partialize
    if (!partializer) return

    const persisted = partializer(state)
    expect(persisted).not.toHaveProperty('coupon')
  })

  it('lastAppliedCouponCode IS persisted (code hint — not discount value)', () => {
    useCartStore.getState().applyCoupon({ code: 'HINT', discount: 100, type: 'flat' })
    const state = useCartStore.getState()
    const partializer = useCartStore.persist?.getOptions?.()?.partialize
    if (!partializer) return

    const persisted = partializer(state) as { lastAppliedCouponCode: string }
    expect(persisted.lastAppliedCouponCode).toBe('HINT')
  })
})

// ─── persist migrate ──────────────────────────────────────────────────────────

describe('cartStore persist — migrate', () => {
  // Extract migrate function directly from Zustand store internals
  function getMigrate() {
    return useCartStore.persist?.getOptions?.()?.migrate as
      | ((persisted: unknown, fromVersion: number) => unknown)
      | undefined
  }

  it('v1 → v3: drops stale coupon field AND strips maxQty from items', () => {
    const migrate = getMigrate()
    if (!migrate) return // skip if API changed

    const v1State = {
      coupon: { code: 'OLD', discount: 50, type: 'flat' },
      idempotencyKey: 'abc',
      items: [{ variantId: 'v1', maxQty: 5, qty: 1 }],
    }
    const result = migrate(v1State, 1) as Record<string, unknown>

    // Coupon dropped (v1→v2 migration)
    expect(result).not.toHaveProperty('coupon')
    // maxQty stripped (v2→v3 migration)
    const items = result.items as Array<Record<string, unknown>>
    expect(items[0]).not.toHaveProperty('maxQty')
  })

  it('v2 → v3: strips maxQty from items but preserves other fields', () => {
    const migrate = getMigrate()
    if (!migrate) return

    const v2State = {
      idempotencyKey: 'xyz',
      items: [
        { variantId: 'v1', maxQty: 10, qty: 2, name: 'Honey' },
        { variantId: 'v2', maxQty: 3, qty: 1, name: 'Ghee' },
      ],
    }
    const result = migrate(v2State, 2) as Record<string, unknown>
    const items = result.items as Array<Record<string, unknown>>

    // maxQty stripped from both items
    expect(items[0]).not.toHaveProperty('maxQty')
    expect(items[1]).not.toHaveProperty('maxQty')
    // Other fields preserved
    expect(items[0].variantId).toBe('v1')
    expect(items[0].qty).toBe(2)
    expect(items[0].name).toBe('Honey')
  })

  it('v1 → v3 direct: applies BOTH coupon drop AND maxQty strip (no early return bug)', () => {
    // Regression: original code returned early from v1 branch, so maxQty
    // would survive if user jumped v1→v3. Fixed by sequential if blocks.
    const migrate = getMigrate()
    if (!migrate) return

    const v1State = {
      coupon: { code: 'STALE', discount: 20, type: 'flat' },
      items: [{ variantId: 'v1', maxQty: 99, qty: 1 }],
    }
    const result = migrate(v1State, 1) as Record<string, unknown>

    // Both migrations applied
    expect(result).not.toHaveProperty('coupon')
    const items = result.items as Array<Record<string, unknown>>
    expect(items[0]).not.toHaveProperty('maxQty')
  })

  it('v3 → v3 (already current): returns state unchanged', () => {
    const migrate = getMigrate()
    if (!migrate) return

    const v3State = {
      idempotencyKey: 'key123',
      items: [{ variantId: 'v1', qty: 1 }],
      lastAppliedCouponCode: 'SAVE',
    }
    const result = migrate(v3State, 3) as Record<string, unknown>
    expect(result.idempotencyKey).toBe('key123')
    expect(result.lastAppliedCouponCode).toBe('SAVE')
  })

  it('handles missing items array gracefully during migration', () => {
    const migrate = getMigrate()
    if (!migrate) return

    // Some edge case: persisted state with no items field at all
    const v1State = {
      coupon: { code: 'X', discount: 10, type: 'flat' },
      idempotencyKey: 'abc',
      // items missing
    }
    expect(() => migrate(v1State, 1)).not.toThrow()
    const result = migrate(v1State, 1) as Record<string, unknown>
    // items defaults to [] when missing
    expect(Array.isArray(result.items)).toBe(true)
    expect((result.items as unknown[]).length).toBe(0)
  })
})

// ─── Hydration-ready flag ───────────────────────────────────────────────────
// BUG FIX: cart/page.tsx and useCheckoutPage previously gated on a generic
// `mounted`/`storeReady` flag flipped by a plain useEffect, which fired
// BEFORE StoreHydrator's deferred persist.rehydrate() resolved — causing an
// EmptyCart flash on /cart and a false redirect-to-/cart on /checkout for
// users with a persisted cart. _hasHydrated fixes this by only flipping true
// inside onRehydrateStorage, once rehydration has actually completed.
describe('cartStore — _hasHydrated flag', () => {
  it('defaults to false before rehydration', () => {
    // beforeEach calls clearCart(), which does not touch _hasHydrated —
    // but a fresh store instance starts with _hasHydrated: false.
    // We can't easily re-create the singleton store here, so instead verify
    // the setter/selector wiring directly.
    useCartStore.getState().setHasHydrated(false)
    expect(useCartStore.getState()._hasHydrated).toBe(false)
    expect(selectHasHydrated(useCartStore.getState())).toBe(false)
  })

  it('setHasHydrated(true) flips the flag and selector reflects it', () => {
    useCartStore.getState().setHasHydrated(true)
    expect(useCartStore.getState()._hasHydrated).toBe(true)
    expect(selectHasHydrated(useCartStore.getState())).toBe(true)
  })

  it('onRehydrateStorage callback sets _hasHydrated to true', () => {
    useCartStore.getState().setHasHydrated(false)
    const onRehydrateStorage = useCartStore.persist?.getOptions?.()?.onRehydrateStorage
    expect(typeof onRehydrateStorage).toBe('function')

    // onRehydrateStorage returns the actual finish-callback
    const finishCallback = onRehydrateStorage?.(useCartStore.getState())
    expect(typeof finishCallback).toBe('function')

    finishCallback?.(useCartStore.getState(), undefined)
    expect(useCartStore.getState()._hasHydrated).toBe(true)
  })

  it('_hasHydrated is not included in persisted (partialized) state', () => {
    const state = useCartStore.getState()
    const partializer = useCartStore.persist?.getOptions?.()?.partialize
    if (!partializer) return

    const persisted = partializer(state)
    expect(persisted).not.toHaveProperty('_hasHydrated')
    expect(persisted).not.toHaveProperty('setHasHydrated')
  })
})

// ─── persist migrate v4 → v5 (Issue 8: duplicated size in PDP-added names) ────
describe('cartStore persist — migrate v4→v5', () => {
  const getMigrate = () =>
    useCartStore.persist?.getOptions?.()?.migrate as
      | ((persisted: unknown, fromVersion: number) => { items: Array<{ name: string }> })
      | undefined

  it('strips a trailing " (size)" that matches the item size', () => {
    const migrate = getMigrate()!
    const out = migrate({ items: [{ productId: '1', variantId: '2', name: 'Himalayan Honey (500g)', size: '500g' }] }, 4)
    expect(out.items[0].name).toBe('Himalayan Honey')
  })

  it('leaves names alone when the parenthetical is not the item size', () => {
    const migrate = getMigrate()!
    const out = migrate({ items: [{ productId: '1', variantId: '2', name: 'Spice Mix (Hot)', size: '250g' }] }, 4)
    expect(out.items[0].name).toBe('Spice Mix (Hot)')
  })

  it('leaves already-plain names and size-less items alone', () => {
    const migrate = getMigrate()!
    const out = migrate({ items: [
      { productId: '1', variantId: '2', name: 'Ghee', size: '500g' },
      { productId: '3', variantId: '4', name: 'Tea (Loose)' },
    ] }, 4)
    expect(out.items.map(i => i.name)).toEqual(['Ghee', 'Tea (Loose)'])
  })
})
