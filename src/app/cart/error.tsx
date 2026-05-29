'use client'

import { useEffect } from 'react'

export default function CartError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[cart] page error:', error)
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
      fontFamily: 'Lato, sans-serif',
    }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>🛍️</div>
      <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#1a1a1a', marginBottom: '10px' }}>
        Cart failed to load
      </h2>
      <p style={{ fontSize: '14px', color: '#666', maxWidth: '400px', lineHeight: 1.6, marginBottom: '28px' }}>
        Something went wrong displaying your cart. Your items are still saved — please try again.
      </p>
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
    </div>
  )
}
