'use client'

import { create } from 'zustand'

interface UIStore {
  isCartOpen:       boolean
  isSearchOpen:     boolean
  isMobileMenuOpen: boolean
  searchQuery:      string

  openCart:         () => void
  closeCart:        () => void
  openSearch:       () => void
  closeSearch:      () => void
  openMobileMenu:   () => void
  closeMobileMenu:  () => void
  setSearchQuery:   (q: string) => void
}

export const useUIStore = create<UIStore>((set) => ({
  isCartOpen:       false,
  isSearchOpen:     false,
  isMobileMenuOpen: false,
  searchQuery:      '',

  openCart:         () => set({ isCartOpen: true }),
  closeCart:        () => set({ isCartOpen: false }),
  openSearch:       () => set({ isSearchOpen: true }),
  closeSearch:      () => set({ isSearchOpen: false, searchQuery: '' }),
  openMobileMenu:   () => set({ isMobileMenuOpen: true }),
  closeMobileMenu:  () => set({ isMobileMenuOpen: false }),
  setSearchQuery:   (q) => set({ searchQuery: q }),
}))
