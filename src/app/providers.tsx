'use client'

import { useEffect } from 'react'
import { SWRConfig } from 'swr'
import { useUserStore } from '@/store/userStore'
import { useCartStore } from '@/store/cartStore'

// ── StoreHydrator ─────────────────────────────────────────────
// Both stores use skipHydration:true — they start with empty defaults
// on BOTH server and client, eliminating SSR/client HTML mismatch.
// After mount, we defer rehydration to after the first paint so React
// has fully committed the server HTML before any state updates occur.
// This is the correct fix for React errors #425, #418, and #423.
function StoreHydrator() {
  useEffect(() => {
    // requestAnimationFrame defers past React's commit phase.
    // This ensures rehydrate()'s synchronous set() calls never interrupt
    // React's render/commit cycle, eliminating errors #425/#418/#423.
    const raf = requestAnimationFrame(() => {
      void useUserStore.persist.rehydrate()
      void useCartStore.persist.rehydrate()
    })
    return () => cancelAnimationFrame(raf)
  }, [])
  return null
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus:     false,
        revalidateOnReconnect: true,
        dedupingInterval:      60_000,
      }}
    >
      <StoreHydrator />
      {children}
    </SWRConfig>
  )
}
