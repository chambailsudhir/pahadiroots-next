'use client'

import { create } from 'zustand'

interface UIStore {
  isCartOpen:       boolean
  isSearchOpen:     boolean
  isMobileMenuOpen: boolean
  isAuthOpen:       boolean
  searchQuery:      string

  openCart:         () => void
  closeCart:        () => void
  openSearch:       () => void
  closeSearch:      () => void
  openMobileMenu:   () => void
  closeMobileMenu:  () => void
  openAuth:         () => void
  closeAuth:        () => void
  setSearchQuery:   (q: string) => void
}

// ── Mutual exclusion helpers ──────────────────────────────────────────────────
// All four panels (cart drawer, search overlay, mobile menu, auth modal) render
// at the same z-index tier. Having two open simultaneously causes:
//   • Double focus traps fighting each other
//   • Stacked backdrop overlays (page goes near-black)
//   • Screen readers announcing two dialog roles at once
//
// Rule: opening any panel closes all others.
const CLOSED_PANELS = {
  isCartOpen:       false,
  isSearchOpen:     false,
  isMobileMenuOpen: false,
  isAuthOpen:       false,
}

export const useUIStore = create<UIStore>((set) => ({
  isCartOpen:       false,
  isSearchOpen:     false,
  isMobileMenuOpen: false,
  isAuthOpen:       false,
  searchQuery:      '',

  openCart:         () => set({ ...CLOSED_PANELS, isCartOpen:       true }),
  closeCart:        () => set({ isCartOpen:       false }),
  openSearch:       () => set({ ...CLOSED_PANELS, isSearchOpen:     true }),
  // closeSearch also resets the query so the next open starts blank.
  closeSearch:      () => set({ isSearchOpen: false, searchQuery: '' }),
  openMobileMenu:   () => set({ ...CLOSED_PANELS, isMobileMenuOpen: true }),
  closeMobileMenu:  () => set({ isMobileMenuOpen: false }),
  openAuth:         () => set({ ...CLOSED_PANELS, isAuthOpen:       true }),
  closeAuth:        () => set({ isAuthOpen:       false }),
  setSearchQuery:   (q) => set({ searchQuery: q }),
}))
