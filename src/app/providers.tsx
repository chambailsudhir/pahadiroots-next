'use client'

import { useEffect, startTransition } from 'react'
import { SWRConfig } from 'swr'
import { useUserStore } from '@/store/userStore'
import { useCartStore } from '@/store/cartStore'

// ── StoreHydrator ─────────────────────────────────────────────
// Both stores use skipHydration:true — they start with empty defaults
// on BOTH server and client, eliminating SSR/client HTML mismatch.
// After mount (client only), we manually trigger rehydration from
// localStorage so the UI gets the real persisted data.
function StoreHydrator() {
  useEffect(() => {
    // startTransition defers rehydration to a non-urgent update.
    // This prevents #425 by ensuring rehydrate()'s synchronous set() calls
    // don't interrupt React's current render/effect processing cycle.
    startTransition(() => {
      void useUserStore.persist.rehydrate()
      void useCartStore.persist.rehydrate()
    })
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
