'use client'

// PERF FIX (F-3 — listing pages were fully dynamic): reading `searchParams` in a
// Server Component makes Next render the route on EVERY request (no ISR, every
// visit and every crawler hits Supabase). Calling useSearchParams() directly in
// the listing component is no better for the HTML: on a statically rendered
// route it bails the whole client subtree up to the nearest <Suspense> out of
// the prerender, so the server HTML would be an empty fallback instead of the
// product grid. This bridge is the only component that touches
// useSearchParams(): it renders nothing, and reports the query string to its
// parent after hydration (and again on every client-side navigation). The
// parent renders the default view until then, which is exactly what the static
// HTML contains, so there is no hydration mismatch and the grid is in the
// prerendered page for SEO/LCP.
import { Suspense, useLayoutEffect } from 'react'
import { useSearchParams } from 'next/navigation'

interface Props { onChange: (params: URLSearchParams) => void }

function Bridge({ onChange }: Props) {
  const sp = useSearchParams()
  const key = sp.toString()
  // Layout effect so the filtered list is committed before the browser paints
  // the default one (avoids a one-frame flash of "All Products" on ?category=).
  useLayoutEffect(() => { onChange(new URLSearchParams(key)) }, [key, onChange])
  return null
}

export default function SearchParamsBridge(props: Props) {
  return <Suspense fallback={null}><Bridge {...props} /></Suspense>
}
