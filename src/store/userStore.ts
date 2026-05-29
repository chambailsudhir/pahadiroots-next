'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { SavedAddress } from '@/types'

interface User {
  id:     string
  phone:  string
  email?: string
  name?:  string
}

interface UserStore {
  user:             User | null
  savedAddresses:   SavedAddress[]
  wishlist:         string[]      // productIds

  setUser:          (user: User | null) => void
  logout:           () => void
  setAddresses:     (addresses: SavedAddress[]) => void
  setWishlist:      (ids: string[]) => void   // used by useAuth to load server wishlist on login
  addToWishlist:    (productId: string) => void
  removeFromWishlist: (productId: string) => void
  isInWishlist:     (productId: string) => boolean
}

export const useUserStore = create<UserStore>()(
  persist(
    (set, get) => ({
      user:           null,
      savedAddresses: [],
      wishlist:       [],

      setUser: (user) => set({ user }),

      logout: () => set({ user: null, savedAddresses: [] }),
      // Note: wishlist is intentionally NOT cleared on logout.
      // Users expect their saved items to still be there when they log back in.
      // Server wishlist is loaded fresh on the next login via useAuth.

      setAddresses: (addresses) => set({ savedAddresses: addresses }),

      // Called by useAuth after login — merges server wishlist with any locally
      // added items so the user never loses work done while logged out.
      setWishlist: (ids) =>
        set(state => ({
          wishlist: Array.from(new Set([...ids, ...state.wishlist])),
        })),

      addToWishlist: (productId) =>
        set(state => ({
          wishlist: state.wishlist.includes(productId)
            ? state.wishlist
            : [...state.wishlist, productId],
        })),

      removeFromWishlist: (productId) =>
        set(state => ({
          wishlist: state.wishlist.filter(id => id !== productId),
        })),

      isInWishlist: (productId) => get().wishlist.includes(productId),
    }),
    {
      name:    'pr-user',
      version: 1,
      skipHydration: true,
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? localStorage : {
          getItem:    () => null,
          setItem:    () => {},
          removeItem: () => {},
        }
      ),
    }
  )
)

// ── Wishlist auto-sync ────────────────────────────────────────────────────────
// Subscribes to wishlist + user changes. Whenever the wishlist changes AND the
// user is logged in, it fires a debounced PUT /api/wishlist so the server stays
// in sync. This means add/remove anywhere (main page, product card, account) is
// automatically persisted without any component needing to call the API itself.
//
// Only runs in the browser (subscribe is a no-op on the server).
if (typeof window !== 'undefined') {
  let syncTimer: ReturnType<typeof setTimeout> | null = null

  useUserStore.subscribe(state => {
    // Only sync when a user is logged in
    if (!state.user?.id) return

    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      // Fire-and-forget — no UI feedback needed for background sync
      fetch('/api/wishlist', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ wishlist: useUserStore.getState().wishlist }),
      }).catch(() => {
        // Silently ignore — next change will retry
      })
    }, 800)   // 800ms debounce — coalesces rapid add/remove taps
  })
}
