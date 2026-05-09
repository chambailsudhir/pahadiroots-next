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
    const timer = window.setTimeout(() => {
      startTransition(() => {
        void useUserStore.persist.rehydrate()
        void useCartStore.persist.rehydrate()
      })
    }, 0)
    return () => window.clearTimeout(timer)
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
