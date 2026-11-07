'use client'

// Nov 2026 verification: there was no root error boundary — an error on any route without its own error.tsx (home, regions,
// blog, collections, policies…) fell through to Next's bare unbranded "Application error" screen with no way back.
import { useEffect } from 'react'
import Link from 'next/link'

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[app] page error:', error)
  }, [error])

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4" role="alert">
      <div className="text-center">
        <div className="text-6xl mb-4" aria-hidden="true">🏔️</div>
        <h1 className="text-2xl font-bold text-stone-900 mb-2">Something went wrong</h1>
        <p className="text-stone-500 text-sm mb-6 max-w-sm mx-auto">
          We hit a snag loading this page. Please try again — your cart is safe.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="px-5 py-2.5 bg-forest-700 hover:bg-forest-800 text-white font-semibold rounded-xl text-sm transition-colors"
          >
            Try again
          </button>
          <Link href="/" className="px-5 py-2.5 border border-stone-200 hover:border-forest-400 text-stone-600 font-semibold rounded-xl text-sm transition-colors">
            Go Home
          </Link>
        </div>
      </div>
    </div>
  )
}
