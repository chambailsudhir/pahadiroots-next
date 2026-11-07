'use client'

import { create } from 'zustand'

interface UIStore {
  isCartOpen:       boolean
  isSearchOpen:     boolean
  isMobileMenuOpen: boolean
  isAuthOpen:       boolean
  /** Help sheet (WhatsApp + Pahadi_AI), see components/layout/HelpLauncher.tsx. */
  isHelpOpen:       boolean
  searchQuery:      string

  openCart:         () => void
  closeCart:        () => void
  openSearch:       () => void
  closeSearch:      () => void
  openMobileMenu:   () => void
  closeMobileMenu:  () => void
  openAuth:         () => void
  closeAuth:        () => void
  openHelp:         () => void
  closeHelp:        () => void
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
  isHelpOpen:       false,
}

let cartOpener: HTMLElement | null = null
/** Element that opened the cart drawer (for returning keyboard focus when it closes). Read once. */
export function takeCartOpener(): HTMLElement | null {
  const el = cartOpener
  cartOpener = null
  return el
}

export const useUIStore = create<UIStore>((set) => ({
  isCartOpen:       false,
  isSearchOpen:     false,
  isMobileMenuOpen: false,
  isAuthOpen:       false,
  isHelpOpen:       false,
  searchQuery:      '',

  openCart:         () => {
    // The drawer is a lazily-loaded chunk: on the first open it mounts after the click, by which time
    // document.activeElement can already be <body>. Remember the real opener here, at click time.
    cartOpener = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      && document.activeElement !== document.body ? document.activeElement : null
    set({ ...CLOSED_PANELS, isCartOpen: true })
  },
  closeCart:        () => set({ isCartOpen:       false }),
  openSearch:       () => set({ ...CLOSED_PANELS, isSearchOpen:     true }),
  // closeSearch also resets the query so the next open starts blank.
  closeSearch:      () => set({ isSearchOpen: false, searchQuery: '' }),
  openMobileMenu:   () => set({ ...CLOSED_PANELS, isMobileMenuOpen: true }),
  closeMobileMenu:  () => set({ isMobileMenuOpen: false }),
  openAuth:         () => set({ ...CLOSED_PANELS, isAuthOpen:       true }),
  closeAuth:        () => set({ isAuthOpen:       false }),
  openHelp:         () => set({ ...CLOSED_PANELS, isHelpOpen:       true }),
  closeHelp:        () => set({ isHelpOpen:       false }),
  setSearchQuery:   (q) => set({ searchQuery: q }),
}))
