'use client'

// ═══════════════════════════════════════════════════════════════
// /reset-password — lands the Supabase password-recovery link
//
// AUDIT S2-001: `forgot_password` (api/auth/route.ts) has always generated a
// recovery link whose redirect_to is `${SITE_URL}/reset-password`, but this
// page did not exist. The link 404'd — and, because GoogleAuthHandler used to
// treat ANY `#access_token` as a Google login, the visitor was silently signed
// in instead of being able to set a new password. Customers who forgot their
// password were locked out.
//
// Flow (Supabase implicit recovery):
//   e-mail link → /reset-password#access_token=<jwt>&type=recovery&…
//   1. read the hash, keep the token in component state only, strip the hash
//      from the URL immediately (no token in history / referrer / analytics)
//   2. user types a new password (≥ RESET_PASSWORD_MIN_LENGTH, confirmed)
//   3. POST /api/auth { action: 'reset_password' } with
//      `Authorization: Bearer <token>` and credentials: 'omit' — the pr_token
//      session cookie is deliberately NOT sent, so a browser already signed in
//      as user A can never reset A's password from B's link (server side
//      prefers the bearer as well)
//   4. result is persisted in sessionStorage so a reload after the hash was
//      stripped still shows the outcome instead of "invalid link"
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import {
  RESET_PASSWORD_MIN_LENGTH, RESET_RESULT_KEY,
  parseRecoveryHash, validateNewPassword,
} from './resetPasswordHelpers'

type Phase = 'checking' | 'ready' | 'submitting' | 'done' | 'invalid'

function readPersistedResult(): 'success' | null {
  try { return sessionStorage.getItem(RESET_RESULT_KEY) === 'success' ? 'success' : null } catch { return null }
}

export default function ResetPasswordPage() {
  const [phase,    setPhase]    = useState<Phase>('checking')
  const [token,    setToken]    = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [error,    setError]    = useState('')

  useEffect(() => {
    // Same shape as /auth/google-callback: the hash can only be read after
    // mount, and the async wrapper keeps state updates out of the effect body.
    ;(async () => {
      const { token: hashToken, error: hashError } = parseRecoveryHash(window.location.hash)

      if (window.location.hash) {
        // Strip the token from the URL before anything else can observe it.
        window.history.replaceState({}, '', window.location.pathname + window.location.search)
      }

      if (hashError) {
        setError(hashError)
        setPhase('invalid')
        return
      }
      if (hashToken) {
        setToken(hashToken)
        setPhase('ready')
        return
      }
      // No token in the URL: a reload after a completed reset, or a bad link.
      setPhase(readPersistedResult() === 'success' ? 'done' : 'invalid')
    })()
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!token) return
    const policyError = validateNewPassword(password, confirm)
    if (policyError) { setError(policyError); return }

    setError('')
    setPhase('submitting')
    try {
      const res = await fetch('/api/auth', {
        method:      'POST',
        // AUDIT S2-001: never send the session cookie — the bearer is the identity.
        credentials: 'omit',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'reset_password', password }),
        signal: AbortSignal.timeout(10_000),
      })
      const data = await res.json().catch(() => ({})) as { success?: boolean; error?: string }
      if (!res.ok || !data.success) {
        setError(data.error || 'Reset failed — the link may have expired. Please request a new one.')
        setPhase('ready')
        return
      }
      try { sessionStorage.setItem(RESET_RESULT_KEY, 'success') } catch {}
      setToken(null)
      setPassword('')
      setConfirm('')
      setPhase('done')
    } catch {
      setError('Network error — please try again.')
      setPhase('ready')
    }
  }

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>🔑</div>
        <h1 style={styles.h1}>Reset your password</h1>

        {phase === 'checking' && <p style={styles.muted}>Checking your reset link…</p>}

        {phase === 'invalid' && (
          <>
            <p style={styles.errorBox} role="alert">
              {error || 'This reset link is invalid or has expired.'}
            </p>
            <p style={styles.muted}>
              Request a new link from the sign-in screen (“Forgot password?”).
            </p>
            <a href="/account" style={styles.button}>Go to sign in</a>
          </>
        )}

        {phase === 'done' && (
          <>
            <p style={styles.successBox} role="status">Your password has been updated.</p>
            <p style={styles.muted}>You can now sign in with your new password.</p>
            <a href="/account" style={styles.button}>Sign in</a>
          </>
        )}

        {(phase === 'ready' || phase === 'submitting') && (
          <form onSubmit={handleSubmit} noValidate>
            <label style={styles.label} htmlFor="rp-password">New password</label>
            <input
              id="rp-password"
              type="password"
              autoComplete="new-password"
              minLength={RESET_PASSWORD_MIN_LENGTH}
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={styles.input}
              disabled={phase === 'submitting'}
            />
            <label style={styles.label} htmlFor="rp-confirm">Confirm new password</label>
            <input
              id="rp-confirm"
              type="password"
              autoComplete="new-password"
              minLength={RESET_PASSWORD_MIN_LENGTH}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              style={styles.input}
              disabled={phase === 'submitting'}
            />
            <p style={styles.hint}>At least {RESET_PASSWORD_MIN_LENGTH} characters.</p>
            {error && <p style={styles.errorBox} role="alert">{error}</p>}
            <button type="submit" style={styles.button} disabled={phase === 'submitting'}>
              {phase === 'submitting' ? 'Updating…' : 'Set new password'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page:   { minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px', background: '#f4f0eb' },
  card:   { width: '100%', maxWidth: 420, background: '#fff', borderRadius: 20, padding: '36px 28px', boxShadow: '0 4px 24px rgba(0,0,0,.08)', textAlign: 'center' },
  h1:     { fontFamily: 'Georgia, serif', color: '#1a3a1e', fontSize: 24, margin: '0 0 20px' },
  label:  { display: 'block', textAlign: 'left', fontSize: 13, fontWeight: 700, color: '#444', margin: '12px 0 6px' },
  input:  { width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 10, border: '1px solid #ddd', fontSize: 15 },
  hint:   { color: '#888', fontSize: 12, textAlign: 'left', margin: '6px 0 0' },
  muted:  { color: '#777', fontSize: 14, margin: '8px 0 16px' },
  button: { display: 'inline-block', width: '100%', boxSizing: 'border-box', marginTop: 18, padding: '14px 20px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#1a5c2a,#2d6a4f)', color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer', textDecoration: 'none' },
  errorBox:   { background: '#fdecea', color: '#b3261e', borderRadius: 10, padding: '10px 12px', fontSize: 13, margin: '14px 0 0' },
  successBox: { background: '#e8f5e9', color: '#1b5e20', borderRadius: 10, padding: '10px 12px', fontSize: 14, fontWeight: 700, margin: '14px 0 0' },
}
