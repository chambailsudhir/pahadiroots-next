'use client'
// Risky Cash-on-Delivery verification step (Nov 2026, owner decision). Shown only when the server asks for it (a first COD order,
// or a COD total above the owner's limit). The code is e-mailed as soon as the dialog opens; entering it places the order.
import { useEffect, useRef, useState } from 'react'
import type { CodVerifyState } from '@/hooks/useCheckoutPage'

interface Props {
  state:     CodVerifyState
  email:     string
  onRequest: () => Promise<void>
  onConfirm: (code: string) => Promise<void>
  onClose:   () => void
  onPayOnline?: () => void
}

export default function CodVerifyDialog({ state, email, onRequest, onConfirm, onClose, onPayOnline }: Props) {
  const [code, setCode] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const requested = useRef(false)

  // Send the first code automatically when the dialog opens (and an e-mail is known).
  useEffect(() => {
    if (!state.open) { requested.current = false; return }
    if (!requested.current && email.trim()) { requested.current = true; void onRequest() }
    inputRef.current?.focus()
  }, [state.open, email, onRequest])

  useEffect(() => {
    if (!state.open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.open, onClose])

  if (!state.open) return null
  const valid = /^\d{6}$/.test(code)

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="cod-verify-title" className="cod-verify-backdrop"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, maxWidth: 420, width: '100%', padding: '22px 20px', boxShadow: '0 10px 40px rgba(0,0,0,.2)' }}>
        <h2 id="cod-verify-title" style={{ margin: '0 0 8px', fontSize: 18, color: '#1a3a1e' }}>Confirm your Cash on Delivery order</h2>
        <p style={{ margin: '0 0 14px', fontSize: 14, color: '#4a4339', lineHeight: 1.5 }}>
          {state.sentTo
            ? <>We sent a 6-digit code to <strong>{state.sentTo}</strong>. Enter it to place your order.</>
            : email.trim()
              ? (state.sending ? 'Sending a 6-digit code to your e-mail…' : 'We will send a 6-digit code to your e-mail.')
              : 'Please enter your e-mail address in the form first — we send the code there.'}
        </p>
        <form onSubmit={e => { e.preventDefault(); if (valid && !state.confirming) void onConfirm(code) }}>
          <label htmlFor="cod-verify-code" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#1a3a1e' }}>Verification code</label>
          <input id="cod-verify-code" ref={inputRef} inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            style={{ width: '100%', fontSize: 22, letterSpacing: 8, textAlign: 'center', padding: '10px 12px', border: '1px solid #c9c2b5', borderRadius: 10, boxSizing: 'border-box' }} />
          {state.error && <p role="alert" style={{ margin: '10px 0 0', color: '#b42318', fontSize: 13 }}>{state.error}</p>}
          <button type="submit" disabled={!valid || state.confirming}
            style={{ marginTop: 14, width: '100%', padding: '12px 0', background: '#1a3a1e', color: '#fff', border: 0, borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: valid ? 'pointer' : 'not-allowed', opacity: valid ? 1 : .6 }}>
            {state.confirming ? 'Placing your order…' : 'Verify & place order'}
          </button>
        </form>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 12, fontSize: 13 }}>
          <button type="button" onClick={() => void onRequest()} disabled={state.sending || !email.trim()}
            style={{ background: 'none', border: 0, color: '#2d6a4f', textDecoration: 'underline', cursor: 'pointer', padding: 4 }}>
            {state.sending ? 'Sending…' : state.sentTo ? 'Resend code' : 'Send code'}
          </button>
          {onPayOnline && (
            <button type="button" onClick={onPayOnline} style={{ background: 'none', border: 0, color: '#2d6a4f', textDecoration: 'underline', cursor: 'pointer', padding: 4 }}>
              Pay online instead
            </button>
          )}
          <button type="button" onClick={onClose} style={{ background: 'none', border: 0, color: '#6b6256', cursor: 'pointer', padding: 4 }}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
