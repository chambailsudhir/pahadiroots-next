'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { CartItem, AppliedCoupon } from '@/types'
import { generateUUID } from '@/lib/utils'

interface CartStore {
  items:             CartItem[]
  coupon:            AppliedCoupon | null
  idempotencyKey:    string           // generated on first item add, reset after order

  // Actions
  addItem:           (item: Omit<CartItem, 'qty'> & { qty?: number }) => void
  removeItem:        (variantId: string) => void
  updateQty:         (variantId: string, qty: number) => void
  applyCoupon:       (coupon: AppliedCoupon) => void
  removeCoupon:      () => void
  clearCart:         () => void
  resetIdempotencyKey: () => void
  ensureIdempotencyKey: () => string

  // Derived
  cartCount:         () => number
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items:          [],
      coupon:         null,
      idempotencyKey: '',

      addItem: (newItem) => {
        set(state => {
          const existing = state.items.find(i => i.variantId === newItem.variantId)
          if (existing) {
            return {
              idempotencyKey: state.idempotencyKey || generateUUID(),
              items: state.items.map(i =>
                i.variantId === newItem.variantId
                  ? { ...i, qty: Math.min(i.qty + (newItem.qty ?? 1), i.maxQty) }
                  : i
              ),
            }
          }
          return {
            idempotencyKey: state.idempotencyKey || generateUUID(),
            items: [...state.items, { ...newItem, qty: newItem.qty ?? 1 }],
          }
        })
      },

      removeItem: (variantId) =>
        set(state => ({ items: state.items.filter(i => i.variantId !== variantId) })),

      updateQty: (variantId, qty) => {
        if (qty <= 0) {
          get().removeItem(variantId)
          return
        }
        set(state => ({
          items: state.items.map(i =>
            i.variantId === variantId
              ? { ...i, qty: Math.min(qty, i.maxQty) }
              : i
          ),
        }))
      },

      applyCoupon:       (coupon) => set({ coupon }),
      removeCoupon:      ()       => set({ coupon: null }),

      clearCart: () => set({
        items:          [],
        coupon:         null,
        // Reset to '' rather than eagerly generating a new UUID.
        // If clearCart fires while the order-success page is still in flight,
        // a retry would otherwise pick up the freshly-minted key and submit
        // a duplicate order. With '' the key is generated lazily on the next
        // addItem() call, which is the only safe moment to do it.
        idempotencyKey: '',
      }),

      resetIdempotencyKey: () => set({ idempotencyKey: generateUUID() }),
      ensureIdempotencyKey: () => {
        const current = get().idempotencyKey
        if (current) return current
        const next = generateUUID()
        set({ idempotencyKey: next })
        return next
      },

      cartCount: () => get().items.reduce((sum, i) => sum + i.qty, 0),
    }),
    {
      name:    'pr-cart',
      version: 2,
      skipHydration: true,
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? localStorage : {
          getItem:    () => null,
          setItem:    () => {},
          removeItem: () => {},
        }
      ),
      // Only persist items and idempotency key.
      // coupon is intentionally excluded — it's session-only so stale/expired
      // discounts can never survive a page refresh. Users re-apply each session.
      partialize: (state) => ({
        items:          state.items,
        idempotencyKey: state.idempotencyKey,
      }),
      // Migrate persisted state across schema versions.
      // v1 had no partialize so coupon may exist in old localStorage — drop it.
      migrate: (persisted: unknown, fromVersion: number) => {
        const state = persisted as Partial<CartStore>
        if (fromVersion < 2) {
          const { coupon: _drop, ...rest } = state as Record<string, unknown>
          void _drop
          return rest
        }
        return state
      },
    }
  )
)
