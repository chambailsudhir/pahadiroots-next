'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { trackPageView } from '@/lib/analytics/track'

// Fires one page_view event per route change (including the first load).
// Lives inside <Providers> so it mounts once, high in the tree, and never
// unmounts between navigations — only the pathname/search params change.
export default function PageViewTracker() {
  const pathname = usePathname()
  const lastTracked = useRef<string | null>(null)

  // The event carries only the path, so de-duplicate on the path too. It used to key on path + query string while sending
  // just the path, so filtering/sorting/paging a listing sent several identical "page views" for one page.
  useEffect(() => {
    if (lastTracked.current === pathname) return
    lastTracked.current = pathname
    trackPageView(pathname)
  }, [pathname])

  return null
}
