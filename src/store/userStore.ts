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
  // Which account the local wishlist belongs to (null = a guest list). A different user signing in on the same browser
  // must never inherit — or upload — the previous user's list (audit Nov 2026).
  wishlistOwner:    string | null
  // Ids the server is known to hold (last GET / successful PATCH). Lets a reload upload only what is NOT yet synced and
  // lets the server list stay authoritative for ids this device did not touch (a removal made on another device sticks).
  lastSynced:       string[]

  // BUG FIX: hydration-race — see matching fields/comment in cartStore.ts.
  _hasHydrated:     boolean
  setHasHydrated:   (state: boolean) => void

  setUser:          (user: User | null) => void
  logout:           (opts?: { clearWishlist?: boolean }) => void
  setAddresses:     (addresses: SavedAddress[]) => void
  setWishlist:      (ids: string[]) => void   // used by useAuth to load server wishlist on login
  addToWishlist:    (productId: string) => void
  removeFromWishlist: (productId: string) => void
  isInWishlist:     (productId: string) => boolean
}

type OwnerPatch = Pick<UserStore, 'wishlistOwner' | 'lastSynced'> & Partial<Pick<UserStore, 'wishlist'>>

/** What has to change in the wishlist bookkeeping when `user` becomes the signed-in user. Empty object = nothing. */
function ownerPatch(state: Pick<UserStore, 'wishlistOwner'>, user: User | null): Partial<OwnerPatch> {
  if (!user) return {}
  const owner = state.wishlistOwner ?? null
  if (owner === user.id) return {}
  if (owner === null) return { wishlistOwner: user.id, lastSynced: [] }               // guest list → merged into this account
  return { wishlistOwner: user.id, wishlist: [], lastSynced: [] }                      // someone else's list → dropped
}

export const useUserStore = create<UserStore>()(
  persist(
    (set, get) => ({
      user:           null,
      savedAddresses: [],
      wishlist:       [],
      wishlistOwner:  null,
      lastSynced:     [],
      _hasHydrated:   false,
      setHasHydrated: (state) => set({ _hasHydrated: state }),

      setUser: (user) => set(state => ({ user, ...ownerPatch(state, user) })),

      logout: (opts) => set(opts?.clearWishlist
        ? { user: null, savedAddresses: [], wishlist: [], wishlistOwner: null, lastSynced: [] }
        : { user: null, savedAddresses: [] }),
      // Note: wishlist is intentionally NOT cleared on logout (opts.clearWishlist, used after account deletion, does).
      // Users expect their saved items to still be there when they log back in. It stays tagged with `wishlistOwner`,
      // so if a DIFFERENT user signs in on this browser the list is dropped (setUser / ownerPatch), never uploaded.

      setAddresses: (addresses) => set({ savedAddresses: addresses }),

      // Called by useAuth after login — merges server wishlist with any locally
      // added items so the user never loses work done while logged out.
      // The server list is authoritative for ids this device did not change since the last sync:
      //   • ids added here and not yet synced are kept (never lose work);
      //   • ids removed here since the last sync stay removed (the pending removal is still on its way);
      //   • ids that were synced but are gone from the server were removed on another device → dropped here too.
      // An empty local list can only ever ADD the server's ids (ACC-052).
      setWishlist: (ids) =>
        set(state => {
          const local = new Set(state.wishlist), synced = new Set(state.lastSynced ?? [])
          const locallyRemoved = new Set([...synced].filter(id => !local.has(id)))
          const locallyAdded   = state.wishlist.filter(id => !synced.has(id))
          return {
            wishlist:   Array.from(new Set([...ids.filter(id => !locallyRemoved.has(id)), ...locallyAdded])),
            lastSynced: Array.from(new Set(ids)),
          }
        }),

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
  let prevSynced = useUserStore.getState().lastSynced
  // Unsent changes
  const pendingAdd    = new Set<string>()
  const pendingRemove = new Set<string>()
  // Changes inside the request that is currently on the wire. They are tracked separately so that an id un-favourited
  // while its add is in flight still queues a remove (it used to be collapsed into nothing → the server kept it).
  let inflightAdd    = new Set<string>()
  let inflightRemove = new Set<string>()
  let sending = false
  let epoch   = 0          // bumped whenever the signed-in user changes; a response from an older epoch is ignored

  function flush() {
    if (sending || (pendingAdd.size === 0 && pendingRemove.size === 0)) return
    const add = [...pendingAdd], remove = [...pendingRemove]
    inflightAdd = new Set(add); inflightRemove = new Set(remove)
    pendingAdd.clear(); pendingRemove.clear()
    const myEpoch = epoch
    sending = true

    const requeue = (dropAdds: boolean) => {
      if (myEpoch !== epoch) return
      // keep the unsent delta for the next attempt — unless the customer has since reversed it
      if (!dropAdds) add.forEach(id => { if (!pendingRemove.has(id)) pendingAdd.add(id) })
      remove.forEach(id => { if (!pendingAdd.has(id)) pendingRemove.add(id) })
    }
    // Fire-and-forget — no UI feedback needed for background sync
    fetch('/api/wishlist', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ add, remove }),
    }).then(async res => {
      if (myEpoch !== epoch) return                         // another user signed in meanwhile: this answer is not theirs
      if (res.ok) {
        let serverList: string[] | null = null
        try { const j = await res.json(); if (Array.isArray(j?.wishlist)) serverList = j.wishlist.map(String) } catch { /* body optional */ }
        const st = useUserStore.getState()
        const base = serverList ?? [...new Set([...(st.lastSynced ?? []), ...add])].filter(id => !remove.includes(id))
        useUserStore.setState({ lastSynced: base })
      } else if (res.status === 409) {
        // list is full (cap) → these adds can never succeed; anything else (concurrent edit) is retried
        let full = false
        try { full = (await res.json())?.code === 'wishlist_full' } catch { /* not JSON */ }
        requeue(full)
      } else {
        requeue(false)                                      // e.g. 401 logged out, 503: retried with the next change
      }
    }).catch((err: unknown) => {
      console.warn('[userStore] wishlist sync failed:', err)
      requeue(false)
    }).finally(() => {
      sending = false
      inflightAdd = new Set(); inflightRemove = new Set()
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

    if (userId !== prevUserId) {
      // The account changed (sign-in, sign-out, switch): deltas collected for the previous user must never be flushed
      // with the new user's cookie.
      if (userId && state.user && (state.wishlistOwner ?? null) !== userId) {
        // user set without setUser(): apply the same ownership rules (drop another user's list / adopt a guest list)
        useUserStore.setState(ownerPatch(state, state.user))
        return                                              // re-enters with owner set; prevUserId is handled there
      }
      const justSignedIn = !prevUserId && !!userId
      prevUserId = userId
      epoch++
      pendingAdd.clear(); pendingRemove.clear(); inflightAdd = new Set(); inflightRemove = new Set()
      prevWishlist = state.wishlist; prevSynced = state.lastSynced   // a list swap on account change is not a customer edit
      // A signed-in user's list that was not yet synced (a guest list being merged, or additions made offline) must reach
      // the account. Offering them as ADDS is safe — adds only ever union into the stored list. Ids that the server is
      // already known to hold are NOT re-sent (a stale device must not resurrect items removed elsewhere).
      if (justSignedIn) {
        const synced = new Set(state.lastSynced ?? [])
        state.wishlist.forEach(id => { if (!synced.has(id)) pendingAdd.add(id) })
        if (pendingAdd.size > 0) schedule()
      }
      return
    }
    if (!userId) { pendingAdd.clear(); pendingRemove.clear(); return }              // guests: local only

    // The server list was just applied (setWishlist) or a sync was confirmed: ids that vanished here were removed on
    // another device — not a customer removal, so nothing is queued.
    if (state.lastSynced !== prevSynced) { prevSynced = state.lastSynced; prevWishlist = state.wishlist; return }

    // Skip unrelated state changes (setAddresses, …) — only a new wishlist array is a wishlist change.
    if (state.wishlist === prevWishlist) return
    const before = new Set(prevWishlist), after = new Set(state.wishlist)
    prevWishlist = state.wishlist

    for (const id of after)  if (!before.has(id)) { pendingAdd.add(id);    pendingRemove.delete(id) }
    for (const id of before) if (!after.has(id)) {
      // added and removed again before anything was sent → the server never needs to hear about it.
      // If an add of this id is already on the wire, the server WILL get it, so the removal must be sent too.
      if (pendingAdd.has(id) && !inflightAdd.has(id)) pendingAdd.delete(id)
      else { pendingAdd.delete(id); pendingRemove.add(id) }
    }
    if (pendingAdd.size > 0 || pendingRemove.size > 0) schedule()
  })
}
