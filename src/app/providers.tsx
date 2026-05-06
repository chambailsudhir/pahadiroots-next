'use client'

import { useEffect } from 'react'
import { SWRConfig } from 'swr'
import { useUserStore } from '@/store/userStore'
import { useCartStore } from '@/store/cartStore'

// ── StoreHydrator ─────────────────────────────────────────────
// Zustand stores use skipHydration:true so they DON'T auto-read
// localStorage during SSR. This ensures server HTML === initial
// client HTML (no mismatch). We then manually rehydrate AFTER
// the client mounts, which is when localStorage is available.
// This permanently eliminates React hydration errors #418/#423/#425.
function StoreHydrator() {
  useEffect(() => {
    useUserStore.persist.rehydrate()
    useCartStore.persist.rehydrate()
  }, [])
  return null
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus:    false,
        revalidateOnReconnect: true,
        dedupingInterval:     60_000,
      }}
    >
      <StoreHydrator />
      {children}
    </SWRConfig>
  )
}
