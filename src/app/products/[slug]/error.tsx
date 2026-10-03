'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function ProductError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[product/slug] page error:', error)
  }, [error])

  return (
    <div style={{
      minHeight: '60vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 24px',
      textAlign: 'center',
      fontFamily: 'var(--font-lato), Lato, sans-serif',
    }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>🌿</div>
      <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#1a1a1a', marginBottom: '10px' }}>
        This product couldn&apos;t be loaded
      </h2>
      <p style={{ fontSize: '14px', color: '#666', maxWidth: '400px', lineHeight: 1.6, marginBottom: '28px' }}>
        We had trouble fetching this product. Please try again or browse our full collection.
      </p>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          onClick={reset}
          style={{
            padding: '12px 28px',
            background: '#1a3a1e',
            color: '#fff',
            border: 'none',
            borderRadius: '30px',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: '0.3px',
          }}
        >
          Try Again
        </button>
        <Link
          href="/products"
          style={{
            padding: '12px 28px',
            background: 'transparent',
            color: '#1a3a1e',
            border: '1.5px solid #1a3a1e',
            borderRadius: '30px',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: '0.3px',
            textDecoration: 'none',
          }}
        >
          All Products
        </Link>
      </div>
    </div>
  )
}
