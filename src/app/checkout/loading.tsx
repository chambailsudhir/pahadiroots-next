/**
 * src/app/checkout/loading.tsx
 *
 * Next.js App Router route-level loading UI.
 * Shows CheckoutSkeleton immediately during navigation to /checkout
 * (before JS downloads + hydrates), so users never see a blank flash.
 *
 * Works in tandem with the storeReady guard in checkout/page.tsx:
 *   - loading.tsx  → shown during Next.js route transition (network/bundle fetch)
 *   - storeReady   → shown during Zustand store rehydration (skipHydration gap)
 *
 * Together these eliminate the 2-3 second blank/skeleton delay that was
 * causing "delivery details appearing late" on the checkout page.
 */
import CheckoutSkeleton from '@/components/checkout/CheckoutSkeleton'

export default function CheckoutLoading() {
  return <CheckoutSkeleton />
}
