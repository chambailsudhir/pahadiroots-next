'use client'

/**
 * useCartRevalidation — C1. On first load of a cart surface (once the persisted cart has
 * hydrated and has items), refresh price / stock / availability from the server and expose
 * what changed so the customer is told, instead of silently seeing stale numbers.
 *
 * One run per mount. Fails open (see lib/cartRevalidate.ts).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { revalidateCart } from '@/lib/cartRevalidate'

export function useCartRevalidation(enabled: boolean) {
  const [notices, setNotices] = useState<string[]>([])
  const ranRef = useRef(false)

  useEffect(() => {
    if (!enabled || ranRef.current) return
    ranRef.current = true
    void revalidateCart().then(r => { if (r.messages.length > 0) setNotices(r.messages) })
  }, [enabled])

  const dismiss = useCallback(() => setNotices([]), [])
  return { notices, dismiss }
}
