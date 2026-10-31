'use client'

import { useId, useState } from 'react'
import styles from './NewsletterBar.module.css'

type Status = 'idle' | 'loading' | 'done' | 'error' | 'invalid' | 'throttled'

// Homepage email capture. Posts to the real `subscribe` action (api/v1/actions), which stores the subscriber,
// creates a single-use 5%-off first-order coupon (30 days) and emails the code — so the promise below is
// fulfilled by the backend, not just advertised.
//
// BUG FIX (audit HOME-002): this component existed but was never mounted, its admin toggle
// (show_newsletter_bar) had no consumer, and the global .nl-* CSS it depended on had been deleted. It is now
// self-styled (CSS module), labelled for screen readers, announces its status via aria-live, and is mounted by
// app/page.tsx behind that same toggle.
export default function NewsletterBar() {
  const [email, setEmail]   = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const fieldId = useId()
  const msgId   = useId()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (status === 'loading') return
    if (!email.includes('@')) { setStatus('invalid'); return }
    setStatus('loading')
    try {
      const res = await fetch('/api/v1/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'subscribe', email }),
      })
      setStatus(res.ok ? 'done' : res.status === 429 ? 'throttled' : 'error')
    } catch { setStatus('error') }
  }

  const message =
    status === 'invalid'   ? 'Please enter a valid email address.' :
    status === 'throttled' ? 'Too many attempts. Please wait a minute and try again.' :
    status === 'error'     ? 'Something went wrong. Please try again.' : ''

  return (
    <section className={styles.sec} aria-labelledby="nl-heading">
      <div className={styles.inner}>
        <div className={styles.chip}><span aria-hidden="true">✉️ </span>Join The Community</div>
        <h2 id="nl-heading" className={styles.h2}>Get 5% Off Your First Order</h2>
        <p className={styles.sub}>Mountain stories, seasonal harvests &amp; exclusive offers. No spam, ever.</p>

        {status === 'done' ? (
          <div className={styles.done} role="status">
            <span aria-hidden="true">🎉 </span>Thank you! Check your inbox for your discount code.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className={styles.form} noValidate aria-describedby={msgId}>
            <label htmlFor={fieldId} className={styles.srOnly}>Email address</label>
            <input
              id={fieldId}
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); if (status === 'invalid' || status === 'error' || status === 'throttled') setStatus('idle') }}
              placeholder="Your email address"
              autoComplete="email"
              inputMode="email"
              required
              aria-invalid={status === 'invalid' || undefined}
              className={styles.input}
            />
            <button type="submit" disabled={status === 'loading'} aria-busy={status === 'loading'} className={styles.btn}>
              {status === 'loading' ? '…' : 'Subscribe →'}
            </button>
          </form>
        )}

        {/* Always rendered so assistive tech reliably announces changes. */}
        <p id={msgId} role="status" aria-live="polite" className={`${styles.msg} ${message ? styles.err : ''}`}>{message}</p>
        <p className={styles.fine}>No spam. Unsubscribe anytime.</p>
      </div>
    </section>
  )
}
