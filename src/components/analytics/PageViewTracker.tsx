'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { trackPageView } from '@/lib/analytics/track'

// Fires one page_view event per route change (including the first load).
// Lives inside <Providers> so it mounts once, high in the tree, and never
// unmounts between navigations — only the pathname/search params change.
export default function PageViewTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const lastTracked = useRef<string | null>(null)

  useEffect(() => {
    const full = `${pathname}?${searchParams.toString()}`
    if (lastTracked.current === full) return
    lastTracked.current = full
    trackPageView(pathname)
  }, [pathname, searchParams])

  return null
}
