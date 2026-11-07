'use client'

// Nov 2026 verification: no global-error.tsx existed, so an error in the root layout itself (header/settings render) showed
// Next's unbranded fallback. This replaces the root layout when it fails, so it renders its own <html>/<body> and uses
// inline styles only (the layout's fonts and global CSS may be what failed). A plain <a> is used for the home link: the
// router may be unusable in this state, and a full navigation is the most reliable way back.
import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[app] root layout error:', error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#f9f4ec', fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}>
        <main role="alert" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', boxSizing: 'border-box', textAlign: 'center' }}>
          <div style={{ maxWidth: 420 }}>
            <div style={{ fontSize: 56, marginBottom: 16 }} aria-hidden="true">🏔️</div>
            <p style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: '#8a6a1f', margin: '0 0 8px' }}>
              HimVeda by Pahadi Roots
            </p>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1a3a1e', margin: '0 0 10px' }}>Something went wrong</h1>
            <p style={{ fontSize: 14, color: '#5a5448', lineHeight: 1.6, margin: '0 0 24px' }}>
              We hit a snag loading the store. Please try again in a moment — your cart is safe.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => reset()}
                style={{ padding: '12px 28px', background: '#1a3a1e', color: '#fff', border: 'none', borderRadius: 30, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >
                Try again
              </button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full navigation on purpose (see top) */}
              <a href="/" style={{ padding: '12px 28px', color: '#1a3a1e', border: '1.5px solid #1a3a1e', borderRadius: 30, fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
                Go Home
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  )
}
