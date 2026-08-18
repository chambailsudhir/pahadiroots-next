'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'

const SEEN_KEY = 'pr_lead_popup_seen'
const SHOW_DELAY_MS = 20_000

// Pages where interrupting the visitor with a discount popup would be
// actively counterproductive (they're already mid-transaction or logged in).
const SKIP_PREFIXES = ['/checkout', '/cart', '/account', '/order-success', '/payment']

export default function LeadCapturePopup() {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone]       = useState(false)
  const [error, setError]     = useState('')

  const shouldSkip = SKIP_PREFIXES.some(p => pathname.startsWith(p))

  useEffect(() => {
    if (shouldSkip) return
    let alreadySeen = false
    try {
      alreadySeen = localStorage.getItem(SEEN_KEY) === '1'
    } catch {
      // storage blocked — treat as not-seen, harmless to show once
    }
    if (alreadySeen) return

    const timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS)
    return () => clearTimeout(timer)
  }, [shouldSkip])

  const dismiss = useCallback(() => {
    setVisible(false)
    try { localStorage.setItem(SEEN_KEY, '1') } catch { /* ignore */ }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Enter a valid email'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'subscribe', email, source: 'popup' }),
      })
      if (!res.ok) throw new Error()
      setDone(true)
      try { localStorage.setItem(SEEN_KEY, '1') } catch { /* ignore */ }
    } catch {
      setError('Could not save right now — please try again')
    } finally {
      setLoading(false)
    }
  }

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Get 5% off your first order"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={dismiss}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#faf7f2', borderRadius: 18, maxWidth: 380, width: '100%',
          padding: '32px 28px 26px', position: 'relative', textAlign: 'center',
          boxShadow: '0 20px 60px rgba(0,0,0,.3)',
          border: '1.5px solid #e8e0d0',
        }}
      >
        <button
          onClick={dismiss}
          aria-label="Close"
          style={{
            position: 'absolute', top: 12, right: 14, background: 'none', border: 'none',
            fontSize: 20, color: '#888', cursor: 'pointer', lineHeight: 1, padding: 4,
          }}
        >
          ✕
        </button>

        {!done ? (
          <>
            <div style={{ fontSize: 34, marginBottom: 6 }}>🌿</div>
            <div style={{ fontFamily: 'var(--font-playfair, serif)', fontSize: 22, fontWeight: 900, color: '#1a3a1e', marginBottom: 6 }}>
              Get 5% Off Your First Order
            </div>
            <div style={{ fontSize: 13.5, color: '#666', marginBottom: 20, lineHeight: 1.5 }}>
              Join the Pahadi family for exclusive deals &amp; Himalayan stories — straight to your inbox.
            </div>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Enter your email address"
                autoComplete="email"
                style={{
                  padding: '12px 14px', borderRadius: 10, border: '1.5px solid #e8e0d0',
                  fontSize: 14, outline: 'none', background: '#fff',
                }}
              />
              {error && <div style={{ fontSize: 12.5, color: '#c0392b' }}>{error}</div>}
              <button
                type="submit"
                disabled={loading}
                style={{
                  padding: '12px 16px', borderRadius: 10, border: 'none',
                  background: '#1a3a1e', color: '#fff', fontWeight: 700, fontSize: 14,
                  cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? 'Saving…' : 'Claim My 5% Off'}
              </button>
            </form>
            <div style={{ fontSize: 11, color: '#999', marginTop: 14 }}>
              No spam, ever. Unsubscribe anytime.
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 34, marginBottom: 6 }}>🎉</div>
            <div style={{ fontFamily: 'var(--font-playfair, serif)', fontSize: 20, fontWeight: 900, color: '#1a3a1e', marginBottom: 6 }}>
              You&apos;re In!
            </div>
            <div style={{ fontSize: 13.5, color: '#666', lineHeight: 1.5 }}>
              Check your inbox for your 5% off code.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
