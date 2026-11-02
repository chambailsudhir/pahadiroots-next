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

// ── Wishlist auto-sync (deltas, never the whole list) ─────────────────────────
// Whenever the wishlist changes AND the user is logged in, the CHANGE — the ids added and the ids removed — is sent to
// PATCH /api/wishlist, which merges it into the list stored on the server.
//
// Why deltas (account audit, Nov 2026 — ACC-052, found by live verification): this used to upload the browser's whole list
// with PUT. After the persisted store rehydrated on a device whose local wishlist was empty (new phone, cleared storage,
// another browser), merely opening the home page sent `PUT {wishlist: []}` and the customer's saved wishlist on the server
// went from [11,28] to []. A delta cannot erase what the customer did not touch:
//   • rehydrating / the login merge (server list ∪ local list) only ever ADD ids → union, nothing is lost;
//   • an id is only sent as "remove" when the customer actually removed it (removeFromWishlist).
// Opposite changes to the same id cancel out; a failed request keeps its delta for the next attempt; identical work is
// never sent twice (also fixes the double PUT seen on login, ACC-047). 800 ms debounce coalesces rapid taps.
//
// Only runs in the browser (subscribe is a no-op on the server).
if (typeof window !== 'undefined') {
  let syncTimer: ReturnType<typeof setTimeout> | null = null
  let prevWishlist: string[] = useUserStore.getState().wishlist
  const pendingAdd    = new Set<string>()
  const pendingRemove = new Set<string>()
  let sending = false

  function flush() {
    if (sending || (pendingAdd.size === 0 && pendingRemove.size === 0)) return
    const add = [...pendingAdd], remove = [...pendingRemove]
    sending = true
    // Fire-and-forget — no UI feedback needed for background sync
    fetch('/api/wishlist', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ add, remove }),
    }).then(res => {
      if (res.ok) {
        add.forEach(id => pendingAdd.delete(id))
        remove.forEach(id => pendingRemove.delete(id))
      }
      // not ok (e.g. 401 logged out, 503): keep the delta — it is sent with the next change / retry
    }).catch((err: unknown) => {
      console.warn('[userStore] wishlist sync failed:', err)
    }).finally(() => {
      sending = false
      if (pendingAdd.size > 0 || pendingRemove.size > 0) schedule()   // changes arrived while this request was in flight
    })
  }
  function schedule() {
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(flush, 800)
  }

  let prevUserId: string | null = useUserStore.getState().user?.id ?? null

  useUserStore.subscribe(state => {
    const userId = state.user?.id ?? null
    const justSignedIn = !prevUserId && !!userId
    prevUserId = userId
    if (!userId) { pendingAdd.clear(); pendingRemove.clear() }                      // guests: local only
    // A guest who built a wishlist and then signs in: those items are not a "change", yet they must reach the account.
    // Offering them all as ADDS is safe — adds only ever union into the stored list.
    if (justSignedIn) { state.wishlist.forEach(id => pendingAdd.add(id)); if (pendingAdd.size > 0) schedule() }

    // Skip unrelated state changes (setAddresses, …) — only a new wishlist array is a wishlist change.
    if (state.wishlist === prevWishlist) return
    const before = new Set(prevWishlist), after = new Set(state.wishlist)
    prevWishlist = state.wishlist

    if (!userId) return

    for (const id of after)  if (!before.has(id)) { pendingAdd.add(id);    pendingRemove.delete(id) }
    for (const id of before) if (!after.has(id)) {
      // added and removed again before anything was sent → the server never needs to hear about it
      if (pendingAdd.has(id)) pendingAdd.delete(id)
      else pendingRemove.add(id)
    }
    if (pendingAdd.size > 0 || pendingRemove.size > 0) schedule()
  })
}
