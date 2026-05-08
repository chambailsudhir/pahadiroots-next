'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
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

  // Derived
  cartCount:         () => number
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items:          [],
      coupon:         null,
      idempotencyKey: generateUUID(),

      addItem: (newItem) => {
        set(state => {
          const existing = state.items.find(i => i.variantId === newItem.variantId)
          if (existing) {
            return {
              items: state.items.map(i =>
                i.variantId === newItem.variantId
                  ? { ...i, qty: Math.min(i.qty + (newItem.qty ?? 1), i.maxQty) }
                  : i
              ),
            }
          }
          return {
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
        idempotencyKey: generateUUID(),  // fresh key for next order
      }),

      resetIdempotencyKey: () => set({ idempotencyKey: generateUUID() }),

      cartCount: () => get().items.reduce((sum, i) => sum + i.qty, 0),
    }),
    {
      name:    'pr-cart',
      version: 1,
    }
  )
)
