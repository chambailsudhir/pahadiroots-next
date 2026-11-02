'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import styles from '../styles/account.module.css'

// "Verify with WhatsApp" for the phone field. Renders nothing unless the server says the feature is on
// (GET /api/v1/phone-verify/enabled), so it ships dark and appears only after the owner configures Meta.

type Phase = 'idle' | 'starting' | 'pending' | 'verified' | 'expired' | 'error'

export const POLL_MS = 3_000
export const POLL_MAX_MS = 120_000

interface Props {
  /** The 10 digits currently in the phone field. */
  phone: string
  /** The saved profile says this number is verified. */
  initiallyVerified: boolean
  /** Saved phone (10 digits) the initial flag refers to. */
  savedPhone: string
  onVerified?: (phone: string) => void
}

const isMobile = (d: string) => /^[6-9]\d{9}$/.test(d)

export default function PhoneVerify({ phone, initiallyVerified, savedPhone, onVerified }: Props) {
  const [enabled, setEnabled] = useState(false)
  const [rawPhase, setPhase] = useState<Phase>('idle')
  const [flowPhone, setFlowPhone] = useState('')
  const [verifiedFor, setVerifiedFor] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const alive = useRef(true)

  const stopPolling = useCallback(() => { if (timer.current) { clearInterval(timer.current); timer.current = null } }, [])

  useEffect(() => {
    alive.current = true
    fetch('/api/v1/phone-verify/enabled', { credentials: 'same-origin', cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive.current && j?.enabled === true) setEnabled(true) })
      .catch(() => {})
    return () => { alive.current = false; stopPolling() }
  }, [stopPolling])

  // Editing the number abandons an in-flight check (the UI below ignores a phase that belongs to another number).
  useEffect(() => { stopPolling() }, [phone, stopPolling])

  if (!enabled) return null

  const phase: Phase = flowPhone === phone ? rawPhase : 'idle'
  const verified = verifiedFor === phone || (initiallyVerified && !!savedPhone && savedPhone === phone)

  async function start() {
    setErr(''); setFlowPhone(phone); setPhase('starting')
    try {
      const res = await fetch('/api/v1/phone-verify/start', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const j = await res.json().catch(() => ({}))
      if (!alive.current) return
      if (!res.ok || typeof j.whatsappUrl !== 'string') {
        setErr(typeof j.error === 'string' ? j.error : 'Could not start verification. Please try again.')
        setPhase('error')
        return
      }
      setLink(j.whatsappUrl); setCode(typeof j.code === 'string' ? j.code : '')
      setPhase('pending')
      window.open(j.whatsappUrl, '_blank', 'noopener,noreferrer')
      poll(phone)
    } catch {
      if (alive.current) { setErr('Network problem. Please try again.'); setPhase('error') }
    }
  }

  function poll(forPhone: string) {
    stopPolling()
    const began = Date.now()
    timer.current = setInterval(async () => {
      if (Date.now() - began >= POLL_MAX_MS) { stopPolling(); if (alive.current) setPhase('expired'); return }
      try {
        const res = await fetch('/api/v1/phone-verify/status', { credentials: 'same-origin', cache: 'no-store' })
        if (!res.ok || !alive.current) return
        const j = await res.json()
        if (j?.verified === true && j.phone === forPhone) {
          stopPolling()
          setVerifiedFor(forPhone); setPhase('verified'); onVerified?.(forPhone)
        }
      } catch { /* keep polling until the time budget runs out */ }
    }, POLL_MS)
  }

  return (
    <div style={{ marginTop: 8 }}>
      {verified ? (
        <span className={styles.saveMsg} data-testid="phone-verified">Verified ✓</span>
      ) : (
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={start}
          disabled={!isMobile(phone) || phase === 'starting' || phase === 'pending'}
        >
          {phase === 'starting' ? 'Starting…' : phase === 'pending' ? 'Waiting for WhatsApp…' : 'Verify with WhatsApp'}
        </button>
      )}
      <div role="status" aria-live="polite" className={styles.fHint}>
        {!verified && phase === 'pending' && (
          <>
            Send the pre-filled WhatsApp message{code ? <> <strong>VERIFY {code}</strong></> : null} from this number. It is checked automatically.{' '}
            <a href={link} target="_blank" rel="noopener noreferrer" className={styles.fHintLink}>Open WhatsApp again</a>
          </>
        )}
        {phase === 'verified' && 'Your mobile number is verified.'}
        {!verified && phase === 'expired' && 'We did not receive your message in time. Tap “Verify with WhatsApp” to try again.'}
      </div>
      {phase === 'error' && <div role="alert" className={styles.errTxt}>{err}</div>}
    </div>
  )
}
