'use client'

// ═══════════════════════════════════════════════════════════════
// /auth/google-callback — handles Supabase implicit OAuth redirect
//
// Supabase sends: /auth/google-callback#access_token=...&refresh_token=...
// This page reads the hash client-side, writes the httpOnly cookie
// via /api/auth/session, then redirects to /account.
//
// ✅ Supabase Google redirect URL must be set to:
//   https://pahadiroots.com/auth/google-callback
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'

export default function GoogleCallbackPage() {
  const [status, setStatus]   = useState<'loading' | 'error'>('loading')
  const [errMsg, setErrMsg]   = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        // Read tokens from URL hash (implicit flow)
        const hash         = window.location.hash.replace(/^#/, '')
        const params       = new URLSearchParams(hash)
        const accessToken  = params.get('access_token')
        const refreshToken = params.get('refresh_token') || ''
        const hashError    = params.get('error_description') || params.get('error')

        // Also check query string for ?error= (Supabase error redirects)
        const qParams = new URLSearchParams(window.location.search)
        const qError  = qParams.get('error_description') || qParams.get('error')

        if (hashError || qError) {
          setErrMsg(hashError || qError || 'Google login failed')
          setStatus('error')
          setTimeout(() => { window.location.href = '/account' }, 3000)
          return
        }

        if (!accessToken) {
          // No token — just go to account (will show login wall)
          window.location.href = '/account'
          return
        }

        // ✅ Write httpOnly cookie via session API
        const res = await fetch('/api/auth/session', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            action:        'set',
            access_token:  accessToken,
            refresh_token: refreshToken,
          }),
        })

        if (!res.ok) {
          console.error('[google-callback] session set failed:', await res.text())
        }

        // ✅ Go to account — useAuth.init() will now find the cookie
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
