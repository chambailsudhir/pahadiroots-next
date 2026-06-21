'use client'

import { useEffect, useState } from 'react'

export default function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // Genuinely necessary exception: this component's entire purpose is
    // deferring render until after client mount (avoiding SSR/CSR hydration
    // mismatches for children that read browser-only state). Whether we're
    // mounted cannot be known during any render phase — only after the
    // effect phase runs — so there is no render-time-adjustment equivalent.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  if (!mounted) return null

  return <>{children}</>
}
