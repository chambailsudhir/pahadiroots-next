'use client'

import { useState } from 'react'

export default function NewsletterBar() {
  const [email, setEmail]   = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.includes('@')) return
    setStatus('loading')
    try {
      const res = await fetch('/api/v1/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'subscribe', email }),
      })
      setStatus(res.ok ? 'done' : 'error')
    } catch { setStatus('error') }
  }

  return (
    <section className="nl-sec">
      <div className="chip" style={{ borderColor: 'rgba(200,146,10,.4)', color: 'var(--gd3)' }}>✉️ Join The Community</div>
      <h2 className="sh2" style={{ color: '#fff', marginTop: 8 }}>Get 5% Off Your First Order</h2>
      <p className="ssub" style={{ color: 'rgba(255,255,255,.65)', marginBottom: 24 }}>
        Mountain stories, seasonal harvests & exclusive offers. No spam, ever.
      </p>

      {status === 'done' ? (
        <div style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 14, padding: '16px 28px', color: '#fff', fontWeight: 700, fontSize: 15 }}>
          🎉 Thank you! Check your inbox for your discount code.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="nlf">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Your email address"
            required
            className="nli"
          />
          <button
            type="submit"
            disabled={status === 'loading'}
            style={{
              background: 'var(--gd)', color: '#1a0800', fontWeight: 800, fontSize: 14,
              border: 'none', borderRadius: 12, padding: '13px 24px', cursor: 'pointer',
              fontFamily: 'Lato, sans-serif', transition: 'background .2s', whiteSpace: 'nowrap',
              opacity: status === 'loading' ? .7 : 1,
            }}
          >
            {status === 'loading' ? '…' : 'Subscribe →'}
          </button>
        </form>
      )}

      {status === 'error' && (
        <p style={{ color: '#fca5a5', fontSize: 12, marginTop: 8 }}>Something went wrong. Please try again.</p>
      )}
      <p style={{ color: 'rgba(255,255,255,.3)', fontSize: 11, marginTop: 12 }}>No spam. Unsubscribe anytime.</p>
    </section>
  )
}
