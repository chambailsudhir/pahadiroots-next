/**
 * cartStore.crossTab.test.ts — S-04 / L-15 (Nov 2026 verification): the cross-tab `storage` listener.
 *
 * F-13 installed a `storage` listener so a stale tab re-reads the cart another tab changed. Untested until now:
 *   • another tab EMPTIED the cart (order placed) → this tab's coupon is dropped too, or the next item added
 *     would show the old discount;
 *   • a non-empty re-read keeps the coupon and carries the live maxQty caps across (persist never stores them);
 *   • events for other keys, and events before the first hydration, are ignored.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useCartStore } from '@/store/cartStore'
import type { CartItem, AppliedCoupon } from '@/types'

const CART_KEY = 'pr-cart'
const item = (over: Partial<CartItem> = {}): CartItem => ({
  productId: 'p1', variantId: 'v1', name: 'Honey', slug: 'honey', price: 100, mrp: 120, qty: 2,
  image: null, size: '500g', maxQty: 7, gstRate: 5, ...over,
} as CartItem)
const coupon = { code: 'PAHADI10', discount: 20 } as unknown as AppliedCoupon

// What another tab leaves in localStorage (persist v5 shape, maxQty stripped by partialize).
function writePersisted(items: Array<Record<string, unknown>>) {
  localStorage.setItem(CART_KEY, JSON.stringify({ state: { items, idempotencyKey: 'k1', lastAppliedCouponCode: 'PAHADI10' }, version: 5 }))
}
async function fireStorage(key: string | null) {
  window.dispatchEvent(new StorageEvent('storage', { key }))
  // rehydrate() is async: let the promise chain inside the listener settle.
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('cartStore — cross-tab storage sync (F-13)', () => {
  beforeEach(() => {
    localStorage.clear()
    useCartStore.setState({ items: [item()], coupon, lastAppliedCouponCode: 'PAHADI10', _hasHydrated: true })
  })

  it('installs the listener once (HMR guard flag set at module load)', () => {
    expect(window.__prCartStorageSync).toBe(true)
  })

  it('another tab emptied the cart → items re-read as empty AND the coupon is dropped here too', async () => {
    writePersisted([])
    await fireStorage(CART_KEY)
    expect(useCartStore.getState().items).toEqual([])
    expect(useCartStore.getState().coupon).toBeNull()
    expect(useCartStore.getState().lastAppliedCouponCode).toBe('')
  })

  it('`storage.clear()` in another tab (key === null) is treated the same way', async () => {
    // The listener treats key === null like a write to the cart key; persist keeps in-memory state when the key is missing,
    // so an explicitly empty persisted cart is what the re-read picks up.
    writePersisted([])
    await fireStorage(null)
    expect(useCartStore.getState().items).toEqual([])
    expect(useCartStore.getState().coupon).toBeNull()
  })

  it('a non-empty re-read keeps the coupon and carries the live maxQty caps across', async () => {
    writePersisted([{ productId: 'p1', variantId: 'v1', name: 'Honey', slug: 'honey', price: 100, mrp: 120, qty: 3, image: null, size: '500g', gstRate: 5 }])
    await fireStorage(CART_KEY)
    const st = useCartStore.getState()
    expect(st.items).toHaveLength(1)
    expect(st.items[0].qty).toBe(3)        // the other tab's quantity wins
    expect(st.items[0].maxQty).toBe(7)     // cap restored from this tab's live copy (persist strips it)
    expect(st.coupon).toEqual(coupon)
  })

  it('ignores storage events for other keys', async () => {
    writePersisted([])
    await fireStorage('some-other-key')
    expect(useCartStore.getState().items).toHaveLength(1)
    expect(useCartStore.getState().coupon).toEqual(coupon)
  })

  it('ignores events before the first hydration (cannot race StoreHydrator)', async () => {
    useCartStore.setState({ _hasHydrated: false })
    writePersisted([])
    await fireStorage(CART_KEY)
    expect(useCartStore.getState().items).toHaveLength(1)
    expect(useCartStore.getState().coupon).toEqual(coupon)
  })
})
