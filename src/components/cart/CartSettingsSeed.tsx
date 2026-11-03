'use client'
// The cart's settings (shipping, free-shipping minimum, COD / prepaid rules…) read on the SERVER by the cart layout and handed down, so the
// order summary can be drawn on the first paint. Before, the summary waited for a browser round-trip to /api/v1/cart-settings (≈1.4 s on a cold
// serverless start) and the right-hand column of the cart appeared late. The hook still refreshes from that endpoint in the background, so
// an admin change shows up without a reload; the seed only removes the wait.
import { createContext, useContext } from 'react'
import type { SiteSettings } from '@/types'

const CartSettingsSeedContext = createContext<Partial<SiteSettings> | null>(null)

export function CartSettingsSeed({ settings, children }: { settings: Partial<SiteSettings>; children: React.ReactNode }) {
  return <CartSettingsSeedContext.Provider value={settings}>{children}</CartSettingsSeedContext.Provider>
}

export function useCartSettingsSeed(): Partial<SiteSettings> | null {
  return useContext(CartSettingsSeedContext)
}
