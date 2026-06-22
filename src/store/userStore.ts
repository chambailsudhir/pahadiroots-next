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

  // BUG FIX: hydration-race — see matching fields/comment in cartStore.ts.
  _hasHydrated:     boolean
  setHasHydrated:   (state: boolean) => void

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
      _hasHydrated:   false,
      setHasHydrated: (state) => set({ _hasHydrated: state }),

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

      // ⚠ IMPERATIVE USE ONLY — never use this as a React selector.
      // `useUserStore(s => s.isInWishlist)` subscribes to the function reference
      // (which never changes), so the component won't re-render when wishlist updates.
      // In React components use the direct selector instead:
      //   const inWishlist = useUserStore(s => s.wishlist.includes(productId))
      isInWishlist: (productId) => get().wishlist.includes(productId),
    }),
    {
      name:    'pr-user',
      version: 1,
      skipHydration: true,
      // BUG FIX: no migrate() function was defined. Without it, Zustand's
      // persist middleware silently discards persisted state when `version`
      // is bumped — users lose their saved wishlist and saved addresses with
      // no warning. The cartStore.ts pattern (sequential migration branches)
      // is the correct model.
      //
      // v1 is the current schema — this function is a no-op today but
      // establishes the structure so future engineers add a `fromVersion < 2`
      // branch here instead of forgetting that migrate() needs to exist.
      migrate: (persisted: unknown, _fromVersion: number) => {
        // v1 → v?: add migration branches here when bumping `version` above.
        // Example:
        //   if (_fromVersion < 2) { /* rename a field */ }
        return persisted as Record<string, unknown>
      },
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? localStorage : {
          getItem:    () => null,
          setItem:    () => {},
          removeItem: () => {},
        }
      ),
      // BUG FIX (hydration-race): see cartStore.ts for the full explanation.
      onRehydrateStorage: () => () => {
        useUserStore.getState().setHasHydrated(true)
      },
    }
  )
)

// ─── Hydration-ready selector ─────────────────────────────────────────────────
// Usage:  const hasHydrated = useUserStore(selectHasHydrated)
export const selectHasHydrated = (s: { _hasHydrated: boolean }): boolean =>
  s._hasHydrated

// ── Wishlist auto-sync ────────────────────────────────────────────────────────
// Subscribes to wishlist changes. Whenever the wishlist array reference changes
// AND the user is logged in, it fires a debounced PUT /api/wishlist.
//
// Key design choices:
//   • prevWishlist reference equality check — Zustand creates a new array
//     reference on every addToWishlist/removeFromWishlist/setWishlist call, so
//     `state.wishlist !== prevWishlist` is true exactly when the wishlist mutates.
//     Without this check, the subscriber fires on every state mutation (login,
//     setAddresses, etc.), triggering needless PUT /api/wishlist calls.
//   • 800 ms debounce — coalesces rapid add/remove taps into a single request.
//   • Fire-and-forget — no UI feedback needed; next change retries on failure.
//
// Only runs in the browser (subscribe is a no-op on the server).
if (typeof window !== 'undefined') {
  let syncTimer: ReturnType<typeof setTimeout> | null = null
  // Track the previous wishlist reference so we can skip unrelated state changes.
  let prevWishlist: string[] = useUserStore.getState().wishlist

  useUserStore.subscribe(state => {
    // Skip if wishlist array reference hasn't changed — this is the guard that
    // prevents syncing on login, setAddresses, or any other unrelated mutation.
    if (state.wishlist === prevWishlist) return
    prevWishlist = state.wishlist

    // Only sync when a user is logged in
    if (!state.user?.id) return

    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      // Fire-and-forget — no UI feedback needed for background sync
      fetch('/api/wishlist', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ wishlist: useUserStore.getState().wishlist }),
      }).catch((err: unknown) => {
        // BUG FIX [ERROR HANDLING]: previously bare `.catch(() => {})` with
        // zero logging. A persistent failure (e.g. the wishlist API broken,
        // an expired auth token that never refreshes) meant wishlist updates
        // silently never reached the server — the debounce comment "next change
        // will retry" is only true for transient failures. A permanent break
        // would quietly lose all wishlist changes with no ops visibility at all.
        // Added a console.warn (not error — this is a background sync, not a
        // critical path) so it shows up in Vercel logs without overwhelming them.
        console.warn('[userStore] wishlist sync failed:', err)
      })
    }, 800)   // 800ms debounce — coalesces rapid add/remove taps
  })
}
