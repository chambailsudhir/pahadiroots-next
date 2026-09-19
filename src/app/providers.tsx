'use client'

import { Suspense, useEffect, startTransition } from 'react'
import { SWRConfig } from 'swr'
import { useUserStore } from '@/store/userStore'
import { useCartStore } from '@/store/cartStore'
import PageViewTracker from '@/components/analytics/PageViewTracker'

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
      <Suspense fallback={null}>
        <PageViewTracker />
        {/* BUG FIX (removed per explicit request): the "Get 5% Off Your
            First Order" email-capture modal (LeadCapturePopup) advertised
            a discount the store isn't actually running — not a bug in the
            popup's own code, a real business-facing mistake in what it
            promised. Un-mounted here rather than deleting the component
            file outright, so it's a one-line change to bring back later
            if a real first-order offer is ever created. */}
      </Suspense>
      {children}
    </SWRConfig>
  )
}
