'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { CartItem, AppliedCoupon } from '@/types'
import { generateUUID } from '@/lib/utils'

interface CartStore {
  items:             CartItem[]
  coupon:            AppliedCoupon | null
  idempotencyKey:    string           // generated on first item add, reset after order
  // The last coupon code the user successfully applied.
  // Persisted (code string only — never the discount amount) so we can hint the
  // user to re-apply after a page refresh clears the ephemeral coupon object.
  // Cleared when the user explicitly removes the coupon or the cart is cleared.
  lastAppliedCouponCode: string

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
  /**
   * @deprecated Use the `selectCartCount` selector instead:
   *   `useCartStore(selectCartCount)`
   *
   * Calling `useCartStore(s => s.cartCount())` returns a new Function reference on
   * every render — Zustand cannot deduplicate it, so the subscribing component
   * re-renders on *every* store update regardless of whether the count changed.
   * `selectCartCount` reads `items` directly and only fires when the count changes.
   */
  cartCount:         () => number
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items:          [],
      coupon:         null,
      idempotencyKey: '',
      lastAppliedCouponCode: '',

      addItem: (newItem) => {
        set(state => {
          const existing = state.items.find(i => i.variantId === newItem.variantId)
          if (existing) {
            // maxQty may be absent on hydrated items (stripped from localStorage).
            // Fall back to a high cap so qty can still increase; the server
            // enforces the real stock limit at order time.
            const cap = existing.maxQty ?? newItem.maxQty ?? 99
            return {
              idempotencyKey: state.idempotencyKey || generateUUID(),
              items: state.items.map(i =>
                i.variantId === newItem.variantId
                  ? { ...i, maxQty: cap, qty: Math.min(i.qty + (newItem.qty ?? 1), cap) }
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

      // BUG FIX: stale idempotencyKey survives "remove all items" cycle.
      //
      // clearCart() resets idempotencyKey to '' so a fresh key is lazily
      // generated on the next addItem (see comment on clearCart below).
      // removeItem() previously did NOT apply the same reset. If a user
      // removed every item one-by-one (rather than using clearCart), the
      // cart became empty but idempotencyKey retained its old value.
      //
      // Impact: the next addItem reuses that stale key for a *completely
      // different* cart (`state.idempotencyKey || generateUUID()` — the old
      // key is truthy, so no new key is generated). If the prior checkout
      // attempt with that key reached the server (e.g. a failed/abandoned
      // order or payment record was created under it), the new checkout
      // — for entirely different items — would be sent with the same
      // idempotency_key. The server's idempotency lookup could then either
      // reject the new order as a duplicate, or worse, return the *old*
      // order's confirmation while the user believes they ordered the new
      // items — a payment-integrity issue.
      //
      // Fix: when removeItem empties the cart, reset idempotencyKey to ''
      // exactly like clearCart does. updateQty's qty<=0 branch calls
      // removeItem internally, so it is covered automatically.
      removeItem: (variantId) =>
        set(state => {
          const items = state.items.filter(i => i.variantId !== variantId)
          return items.length === 0
            ? { items, idempotencyKey: '' }
            : { items }
        }),

      updateQty: (variantId, qty) => {
        if (qty <= 0) {
          get().removeItem(variantId)
          return
        }
        set(state => ({
          items: state.items.map(i =>
            i.variantId === variantId
              ? { ...i, qty: Math.min(qty, i.maxQty ?? 99) }
              : i
          ),
        }))
      },

      applyCoupon:       (coupon) => set({ coupon, lastAppliedCouponCode: coupon.code }),
      removeCoupon:      ()       => set({ coupon: null, lastAppliedCouponCode: '' }),

      clearCart: () => set({
        items:          [],
        coupon:         null,
        lastAppliedCouponCode: '',
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
      version: 3,  // bumped: strips maxQty from persisted items (security fix)
      skipHydration: true,
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? localStorage : {
          getItem:    () => null,
          setItem:    () => {},
          removeItem: () => {},
        }
      ),
      // Only persist item identity + qty + idempotency key.
      //
      // Intentionally excluded:
      //   coupon   — session-only; stale/expired discounts must not survive a refresh.
      //   maxQty   — stock cap must NOT be persisted. A user who edits localStorage to
      //              raise maxQty could bypass client-side stock guards. The server
      //              always re-checks stock, but we also clamp client-side so the UI
      //              is correct. On hydration, maxQty falls back to a safe default (1)
      //              until the product page or upsell fetch supplies the live value.
      partialize: (state) => ({
        items: state.items.map(({ maxQty: _drop, ...rest }) => {
          void _drop   // strip maxQty from every persisted item
          return rest
        }),
        idempotencyKey: state.idempotencyKey,
        // Persist code string only — the discount is never trusted from storage.
        // On hydration CartPage checks this and pre-fills the coupon input so
        // the user knows to re-apply rather than wondering why their discount vanished.
        lastAppliedCouponCode: state.lastAppliedCouponCode,
      }),
      // Migrate persisted state across schema versions.
      // v1: no partialize — coupon may exist in old localStorage, drop it.
      // v2: items persisted with maxQty — strip it on load.
      // v3: items persisted without maxQty (current).
      //
      // Bug-fix: the original fromVersion < 2 branch returned early, so a user
      // upgrading directly from v1 → v3 (never having run v2) would have their
      // coupon dropped correctly but maxQty would survive in persisted items,
      // because the fromVersion < 3 strip was never reached. Fixed by applying
      // all outstanding migrations in sequence (not with early returns).
      migrate: (persisted: unknown, fromVersion: number) => {
        let state = persisted as Record<string, unknown>

        // v1 → v2: drop stale coupon field
        if (fromVersion < 2) {
          const { coupon: _c, ...rest } = state
          void _c
          state = rest
        }

        // v2 → v3: strip maxQty from every persisted item (security fix)
        if (fromVersion < 3) {
          const items = (state.items as Array<Record<string, unknown>> | undefined) ?? []
          state = {
            ...state,
            items: items.map(({ maxQty: _mq, ...rest }) => {
              void _mq
              return rest
            }),
          }
        }

        return state
      },
    }
  )
)

// ─── Stable selector ──────────────────────────────────────────────────────────
// Use this in components instead of `useCartStore(s => s.cartCount())`.
// `cartCount` is a plain function inside the store; calling it via a selector
// returns a new Function reference on every render, so React can't deduplicate
// re-renders. This selector reads `items` directly — Zustand's equality check
// fires only when the total actually changes.
//
// Usage:  const count = useCartStore(selectCartCount)
export const selectCartCount = (s: { items: CartItem[] }): number =>
  s.items.reduce((sum, i) => sum + i.qty, 0)
