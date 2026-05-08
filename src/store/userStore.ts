'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
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

      setAddresses: (addresses) => set({ savedAddresses: addresses }),

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
    }
  )
)
