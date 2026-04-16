'use client'

import { useState } from 'react'

export default function NewsletterBar() {
  const [email, setEmail]     = useState('')
  const [status, setStatus]   = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.includes('@')) return
    setStatus('loading')
    try {
      const res = await fetch('/api/v1/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'subscribe', email }),
      })
      setStatus(res.ok ? 'done' : 'error')
    } catch {
      setStatus('error')
    }
  }

  return (
    <section className="py-14 bg-forest-900">
      <div className="max-w-xl mx-auto px-4 text-center">
        <div className="text-3xl mb-3">🌿</div>
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">
          Get 5% off your first order
        </h2>
        <p className="text-forest-300 text-sm mb-6">
          Subscribe for mountain stories, seasonal harvests, and exclusive offers.
        </p>

        {status === 'done' ? (
          <div className="bg-forest-700 text-forest-100 rounded-xl py-4 px-6 text-sm font-semibold">
            🎉 Thank you! Check your inbox for your discount code.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Your email address"
              required
              className="flex-1 bg-white/10 border border-white/20 text-white placeholder:text-white/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-white/50 transition-colors"
            />
            <button
              type="submit"
              disabled={status === 'loading'}
              className="bg-earth-500 hover:bg-earth-600 text-white font-bold px-6 py-3 rounded-xl text-sm transition-colors disabled:opacity-60 whitespace-nowrap"
            >
              {status === 'loading' ? '…' : 'Subscribe'}
            </button>
          </form>
        )}

        {status === 'error' && (
          <p className="text-red-400 text-xs mt-2">Something went wrong. Please try again.</p>
        )}

        <p className="text-forest-500 text-xs mt-3">No spam. Unsubscribe anytime.</p>
      </div>
    </section>
  )
}
