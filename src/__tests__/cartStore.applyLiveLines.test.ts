/** C1 — cartStore.applyLiveLines */
import { describe, it, expect, beforeEach } from 'vitest'
import { useCartStore } from '@/store/cartStore'
import type { CartItem } from '@/types'

const base = { productId: 'p1', variantId: 'v1', name: 'Honey', slug: 'h', image: null, emoji: null, size: '500g', price: 500, mrp: 600, gstRate: 5, qty: 2, isOrganic: false, isHimalayan: false, isBestseller: false } as CartItem
const live = (over = {}) => ({ productId: 'p1', variantId: 'v1', status: 'ok' as const, name: 'Honey', price: 500, mrp: 600, available: 10, ...over })

beforeEach(() => { useCartStore.getState().clearCart(); useCartStore.setState({ _hasHydrated: true }) })

describe('cartStore.applyLiveLines', () => {
  it('updates price, caps qty, restores maxQty and returns the changes', () => {
    useCartStore.getState().addItem({ ...base, qty: 5 })
    const changes = useCartStore.getState().applyLiveLines([live({ price: 550, available: 3, status: 'insufficient_stock' })])
    const it = useCartStore.getState().items[0]
    expect(it).toMatchObject({ price: 550, qty: 3, maxQty: 3 })
    expect(changes.map(c => c.type).sort()).toEqual(['price_changed', 'qty_reduced'])
  })

  it('after a reload (maxQty stripped) it restores the stock cap so updateQty can no longer exceed stock (C3)', () => {
    useCartStore.getState().addItem({ ...base, qty: 1 })
    useCartStore.setState(s => ({ items: s.items.map(({ maxQty: _m, ...r }) => { void _m; return r as CartItem }) }))   // simulate rehydrated state
    useCartStore.getState().applyLiveLines([live({ available: 4 })])
    useCartStore.getState().updateQty('v1', 50)
    expect(useCartStore.getState().items[0].qty).toBe(4)
  })

  it('removing the last line resets key and coupon exactly like removeItem/clearCart', () => {
    useCartStore.getState().addItem(base)
    useCartStore.getState().applyCoupon({ code: 'X10', discount: 50 } as never)
    expect(useCartStore.getState().idempotencyKey).not.toBe('')
    useCartStore.getState().applyLiveLines([live({ status: 'out_of_stock', available: 0 })])
    const s = useCartStore.getState()
    expect(s.items).toEqual([])
    expect(s.idempotencyKey).toBe('')
    expect(s.coupon).toBeNull()
    expect(s.lastAppliedCouponCode).toBe('')
  })

  it('keeps the idempotency key when items remain', () => {
    useCartStore.getState().addItem(base)
    useCartStore.getState().addItem({ ...base, variantId: 'v2', productId: 'p2' })
    const key = useCartStore.getState().idempotencyKey
    useCartStore.getState().applyLiveLines([live({ status: 'unavailable', available: 0 })])
    expect(useCartStore.getState().items.map(i => i.variantId)).toEqual(['v2'])
    expect(useCartStore.getState().idempotencyKey).toBe(key)
  })
})
