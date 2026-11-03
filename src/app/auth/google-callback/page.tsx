'use client'

// ═══════════════════════════════════════════════════════════════
// /auth/google-callback — landing page of the Google OAuth redirect (PKCE flow)
//
// `google_oauth` (api/auth) starts the flow with a PKCE code_challenge and stores the matching
// code_verifier in a short-lived HttpOnly cookie in THIS browser. Supabase returns here with
// `?code=<auth code>`; we post only the code to `google_callback`, which redeems it with the cookie's
// verifier and then sets the session cookies.
//
// AUDIT (auth-B #1): this page used to take `#access_token=…&refresh_token=…` from the URL hash and
// store those tokens as the session without any binding to the browser that started the flow, so a link
// crafted with an attacker's own tokens signed the victim into the attacker's account (login CSRF /
// session fixation). Tokens in the URL are now ignored completely; a code without this browser's
// verifier cookie cannot be redeemed.
//
// Set your Supabase Google redirect URL to:
//   https://www.pahadiroots.com/auth/google-callback
// ═══════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import { completeGoogleLogin } from '@/lib/auth/googleLogin'

export default function GoogleCallbackPage() {
  const [status, setStatus] = useState<'loading' | 'error'>('loading')
  const [errMsg, setErrMsg] = useState('')
  // React strict mode runs effects twice in dev; an auth code is single-use, so run exactly once.
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      try {
        const qParams = new URLSearchParams(window.location.search)
        const hParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
        const code    = qParams.get('code')
        const failure = qParams.get('error_description') || qParams.get('error')
                     || hParams.get('error_description') || hParams.get('error')

        // Remove code / tokens / errors from the address bar immediately (history, referrer, analytics).
        window.history.replaceState({}, '', window.location.pathname)

        if (failure) {
          // never show provider / URL text in our UI (content spoofing): fixed wording only
          setErrMsg(/access_denied|cancel/i.test(failure) ? 'Google sign-in was cancelled.' : 'Google sign-in could not be completed. Please try again.')
          setStatus('error')
          setTimeout(() => { window.location.href = '/account' }, 3000)
          return
        }

        // No code (e.g. a legacy `#access_token=` link): never log in from URL tokens — go to /account.
        if (!code) { window.location.href = '/account'; return }

        const result = await completeGoogleLogin(code)
        if (!result.ok) {
          setErrMsg(result.error)
          setStatus('error')
          setTimeout(() => { window.location.href = '/account' }, 3000)
          return
        }
        window.location.href = '/account'
      } catch (e) {
        console.error('[google-callback] error:', e)
        window.location.href = '/account'
      }
    })()
  }, [])

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#f4f0eb', fontFamily: 'Arial, sans-serif',
    }}>
      {status === 'loading' ? (
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 40, height: 40, border: '3px solid #e8e3db',
            borderTopColor: '#1a3a1e', borderRadius: '50%',
            animation: 'spin 0.9s linear infinite', margin: '0 auto 16px',
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ color: '#888', fontSize: 15, margin: 0 }}>Signing you in…</p>
        </div>
      ) : (
        <div style={{ textAlign: 'center', background: '#fff', padding: '40px 32px', borderRadius: 20, boxShadow: '0 4px 24px rgba(0,0,0,.08)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <p style={{ color: '#c0392b', fontWeight: 700, marginBottom: 8 }}>Google login failed</p>
          <p style={{ color: '#888', fontSize: 13 }}>{errMsg}</p>
          <p style={{ color: '#aaa', fontSize: 12, marginTop: 16 }}>Redirecting you back…</p>
        </div>
      )}
    </div>
  )
}
