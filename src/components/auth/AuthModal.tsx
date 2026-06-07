'use client'

import { useState, useEffect, useRef } from 'react'
import { useUIStore } from '@/store/uiStore'
import { useUserStore } from '@/store/userStore'
import { buildCacheEntry, writeProfileCache, prefetchProfileToCache } from '@/lib/profileCache'

type AuthTab = 'email' | 'signup'

async function callAuth(action: string, body: Record<string, unknown> = {}, token?: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = 'Bearer ' + token
  const res  = await fetch('/api/auth', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...body }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Auth error')
  return data
}

// PKCE helpers — same as old site's auth-frontend.js
function genVerifier(): string {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return btoa(String.fromCharCode(...Array.from(arr)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function genChallenge(v: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))
  return btoa(String.fromCharCode(...Array.from(new Uint8Array(hash))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export default function AuthModal() {
  const { isAuthOpen, closeAuth } = useUIStore()
  const setUser = useUserStore(s => s.setUser)

  const [tab,     setTab]     = useState<AuthTab>('email')
  const [email,   setEmail]   = useState('')
  const [pass,    setPass]    = useState('')
  const [fname,   setFname]   = useState('')
  const [lname,   setLname]   = useState('')
  const [phone,   setPhone]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [fieldErr, setFieldErr] = useState<Record<string,string>>({})
  const [success, setSuccess] = useState('')
  const [showFP,  setShowFP]  = useState(false)
  const [fpEmail, setFPEmail] = useState('')
  const [fpSent,  setFPSent]  = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isAuthOpen) {
      setError(''); setSuccess(''); setLoading(false)
      setTimeout(() => emailRef.current?.focus(), 100)
    }
  }, [isAuthOpen])

  useEffect(() => {
    if (!isAuthOpen) return

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeAuth(); return }

      // Focus trap: cycle Tab/Shift+Tab within the modal
      if (e.key !== 'Tab') return
      const el = modalRef.current
      if (!el) return
      const focusable = Array.from(
        el.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])'
        )
      ).filter(n => n.offsetParent !== null) // skip hidden elements
      if (focusable.length === 0) return
      const first = focusable[0]
      const last  = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus()
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isAuthOpen, closeAuth])

  if (!isAuthOpen) return null

  // ── Validation helpers ──────────────────────────────────────────────
  function isValidEmail(e: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim()) }
  function isValidPhone(p: string) { return /^[6-9]\d{9}$/.test(p.replace(/\D/g,'')) }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    const em = email.trim()
    if (!em)         { setError('Please enter your email address'); return }
    if (!isValidEmail(em)) { setError('Please enter a valid email address (e.g. you@example.com)'); return }
    if (!pass)       { setError('Please enter your password'); return }
    if (pass.length < 6) { setError('Password must be at least 6 characters'); return }
    setLoading(true); setError(''); setSuccess('')
    try {
      const data = await callAuth('email_login', { email: em, password: pass })
      // SEC-FIX: removed localStorage.setItem('pr_auth_token' / 'pr_auth_refresh') calls.
      // The /api/auth route writes tokens only into httpOnly cookies — the response body
      // contains { success, user, profile }, never tokens. data.access_token is always
      // undefined here, so these writes were dead code. Keeping them was a security
      // landmine: any future change that accidentally added tokens to the response body
      // would silently re-expose them to XSS via localStorage. Removed entirely.
      // pr_auth_profile localStorage is also removed — profile data is now in the
      // profileCache (writeProfileCache below) which is a safer, explicit abstraction.
      setUser({
        id:    data.user?.id || '',
        email: data.user?.email || em,
        name:  data.profile?.first_name || data.user?.user_metadata?.full_name || '',
        phone: data.profile?.phone || '',
      })

      // ── Pre-warm checkout cache at login (old site pattern: pr_auth_profile) ──
      // data.profile has basic fields but may lack saved_addresses from DB.
      // Step 1: write what we have immediately (fills name/phone/default address).
      if (data.profile) {
        writeProfileCache(buildCacheEntry(data.profile))
      }
      // Step 2: fetch full profile with all saved_addresses in background.
      // By the time the user navigates to checkout, this is already done.
      prefetchProfileToCache()

      setSuccess('✅ Welcome back!')
      setTimeout(() => { closeAuth(); window.location.reload() }, 700)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('credentials') || msg.toLowerCase().includes('wrong')) {
        setError('❌ Incorrect email or password. Please try again.')
      } else {
        setError(msg || 'Login failed. Please try again.')
      }
    }
    finally { setLoading(false) }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    const em = email.trim()
    if (!fname.trim())    { setError('Please enter your first name'); return }
    if (!em)              { setError('Please enter your email address'); return }
    if (!isValidEmail(em)) { setError('Please enter a valid email (e.g. you@example.com)'); return }
    if (!pass)            { setError('Please enter a password'); return }
    if (pass.length < 6)  { setError('Password must be at least 6 characters'); return }
    if (phone && !isValidPhone(phone)) { setError('Enter a valid 10-digit Indian mobile number (starts with 6-9)'); return }
    setLoading(true); setError(''); setSuccess('')
    try {
      await callAuth('email_signup', {
        email: em, password: pass,
        full_name: [fname.trim(), lname.trim()].filter(Boolean).join(' '),
        phone: phone ? '+91' + phone.replace(/\D/g,'') : '',
      })
      setSuccess('✅ Account created! Check your email to verify.')
      setTimeout(() => setTab('email'), 2000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.toLowerCase().includes('already')) {
        setError('An account with this email already exists. Please login instead.')
      } else {
        setError(msg || 'Registration failed. Please try again.')
      }
    }
    finally { setLoading(false) }
  }

  async function handleGoogle() {
    setLoading(true); setError('')
    try {
      // Use server-side callback — sets httpOnly cookie and redirects to /account
      const res  = await fetch('/api/auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'google_oauth' }),
      })
      const data = await res.json() as { url?: string; error?: string }
      if (data.url) { window.location.href = data.url; return }
      setError(data.error || 'Google login unavailable')
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Google login failed') }
    setLoading(false)
  }

  async function handleFP(e: React.FormEvent) {
    e.preventDefault()
    if (!fpEmail.trim()) { setError('Please enter your email'); return }
    setLoading(true); setError('')
    try { await callAuth('forgot_password', { email: fpEmail.trim() }); setFPSent(true) }
    catch (err: unknown) { setError(err instanceof Error ? err.message : 'Failed') }
    finally { setLoading(false) }
  }

  return (
    <div className="am-ov" onClick={e => e.target === e.currentTarget && closeAuth()} role="presentation">
      <div className="am-box" ref={modalRef} role="dialog" aria-modal="true" aria-label="Sign in to 5 Pahadi Roots">
        <button className="am-close" onClick={closeAuth}>✕</button>

        {/* Header */}
        <div className="am-head">
          <div className="am-logo">🌿 5 Pahadi Roots</div>
          <div className="am-logo-sub">Himalayan Natural Store</div>
        </div>

        {showFP ? (
          <div style={{ padding: '24px' }}>
            <button className="am-back" onClick={() => { setShowFP(false); setError(''); setFPSent(false) }}>← Back to Login</button>
            <h3 className="am-sec-title">Reset Password</h3>
            {fpSent
              ? <div className="am-success">✅ Reset link sent! Check your email inbox.</div>
              : <form onSubmit={handleFP}>
                  <div className="am-field">
                    <label className="am-lbl">Email Address</label>
                    <input className="am-inp" type="email" value={fpEmail} onChange={e => setFPEmail(e.target.value)} placeholder="you@example.com" />
                  </div>
                  {error && <div className="am-err">{error}</div>}
                  <button className="am-submit" disabled={loading}>{loading ? 'Sending…' : 'Send Reset Link'}</button>
                </form>}
          </div>
        ) : (
          <>
            <div className="am-tabs">
              <button className={`am-tab${tab === 'email' ? ' active' : ''}`} onClick={() => { setTab('email'); setError('') }}>✉️ Email</button>
              <button className={`am-tab${tab === 'signup' ? ' active' : ''}`} onClick={() => { setTab('signup'); setError('') }}>Sign Up</button>
            </div>

            <div className="am-body">
              <button className="am-google" onClick={handleGoogle} disabled={loading} type="button">
                <svg width="18" height="18" viewBox="0 0 48 48">
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.16C6.51 42.62 14.62 48 24 48z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.5-1.45-.79-3-.79-4.59s.29-3.14.79-4.59l-7.98-6.16C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.55 10.75l7.98-6.16z"/>
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.55 13.25l7.98 6.16C12.43 13.72 17.74 9.5 24 9.5z"/>
                </svg>
                Continue with Google
              </button>
              <div className="am-divider"><span>or continue with</span></div>

              {tab === 'email'
                ? <form onSubmit={handleLogin}>
                    <div className="am-greeting">Welcome back 👋</div>
                    <div className="am-greeting-sub">Login to manage your orders &amp; account</div>
                    <div className="am-field">
                      <label className="am-lbl">Email Address</label>
                      <input ref={emailRef} className={`am-inp${fieldErr.email?' am-inp-err':''}`} type="email" value={email} onChange={e => { setEmail(e.target.value); setFieldErr(f=>({...f,email:''})) }} placeholder="you@example.com" autoComplete="email" />
                      {fieldErr.email && <span className="am-field-err">{fieldErr.email}</span>}
                    </div>
                    <div className="am-field" style={{ position: 'relative' }}>
                      <label className="am-lbl">Password</label>
                      <input className={`am-inp${fieldErr.pass?' am-inp-err':''}`} type="password" value={pass} onChange={e => { setPass(e.target.value); setFieldErr(f=>({...f,pass:''})) }} placeholder="Your password" autoComplete="current-password" />
                      <button type="button" className="am-fp-link" onClick={() => { setShowFP(true); setError(''); setFPEmail(email) }}>Forgot Password?</button>
                    </div>
                    {error   && <div className="am-err">{error}</div>}
                    {success && <div className="am-success">{success}</div>}
                    <button className="am-submit" disabled={loading}>{loading ? 'Logging in…' : 'Login'}</button>
                    <p className="am-switch">Don't have an account? <button type="button" className="am-switch-btn" onClick={() => { setTab('signup'); setError('') }}>Sign Up</button></p>
                  </form>
                : <form onSubmit={handleSignup}>
                    <div className="am-greeting">Create Account 🌿</div>
                    <div className="am-greeting-sub">Join 10K+ Himalayan product lovers</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div className="am-field">
                        <label className="am-lbl">First Name *</label>
                        <input className="am-inp" type="text" value={fname} onChange={e => setFname(e.target.value)} placeholder="Ravi" />
                      </div>
                      <div className="am-field">
                        <label className="am-lbl">Last Name</label>
                        <input className="am-inp" type="text" value={lname} onChange={e => setLname(e.target.value)} placeholder="Kumar" />
                      </div>
                    </div>
                    <div className="am-field">
                      <label className="am-lbl">Email Address *</label>
                      <input className={`am-inp${fieldErr.email?' am-inp-err':''}`} type="email" value={email} onChange={e => { setEmail(e.target.value); setFieldErr(f=>({...f,email:''})) }} placeholder="you@example.com" autoComplete="email" />
                      {fieldErr.email && <span className="am-field-err">{fieldErr.email}</span>}
                    </div>
                    <div className="am-field">
                      <label className="am-lbl">Phone (Optional)</label>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ padding: '10px 12px', background: '#f5f5f5', borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#555', flexShrink: 0 }}>+91</span>
                        <input className="am-inp" style={{ flex: 1 }} type="tel" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g,''))} placeholder="10-digit mobile" maxLength={10} />
                      </div>
                    </div>
                    <div className="am-field">
                      <label className="am-lbl">Password *</label>
                      <input className="am-inp" type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="Minimum 6 characters" />
                    </div>
                    {error   && <div className="am-err">{error}</div>}
                    {success && <div className="am-success">{success}</div>}
                    <button className="am-submit" disabled={loading}>{loading ? 'Creating…' : 'Create Account'}</button>
                    <p className="am-switch">Already have an account? <button type="button" className="am-switch-btn" onClick={() => { setTab('email'); setError('') }}>Login</button></p>
                  </form>}

              {/* Quick links */}
              <div className="am-ql-wrap">
                {[
                  { icon: '📦', label: 'My Orders',       sub: 'Track & manage orders' },
                  { icon: '🤍', label: 'Wishlist',         sub: 'Saved products' },
                  { icon: '🎟️', label: 'Coupons',          sub: 'Your discount codes' },
                  { icon: '📍', label: 'Saved Addresses',  sub: 'Delivery locations' },
                  { icon: '💬', label: 'Contact Us',       sub: "We're here to help" },
                ].map(q => (
                  <div key={q.label} className="am-ql-item">
                    <span className="am-ql-icon">{q.icon}</span>
                    <div><div className="am-ql-lbl">{q.label}</div><div className="am-ql-sub">{q.sub}</div></div>
                    <span className="am-ql-arr">›</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <style>{`
          .am-ov{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10000;display:flex;align-items:stretch;justify-content:flex-end;backdrop-filter:blur(2px)}
          .am-box{background:#fff;width:100%;max-width:400px;overflow-y:auto;position:relative;box-shadow:-8px 0 40px rgba(0,0,0,.2);animation:am-slide .28s cubic-bezier(.25,.46,.45,.94)}
          @keyframes am-slide{from{transform:translateX(100%)}to{transform:translateX(0)}}
          @media(max-width:440px){.am-box{max-width:100%}}
          .am-close{position:absolute;top:14px;right:16px;width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.2);border:none;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;z-index:2;transition:background .2s}
          .am-close:hover{background:rgba(255,255,255,.35)}
          .am-head{background:linear-gradient(135deg,#1a3a1e,#2d5233);padding:24px 24px 20px}
          .am-logo{font-family:'Playfair Display',serif;font-size:18px;font-weight:900;color:#fff}
          .am-logo-sub{font-size:10px;color:rgba(255,255,255,.6);letter-spacing:1px;text-transform:uppercase;margin-top:2px}
          .am-tabs{display:flex;border-bottom:1px solid #eee}
          .am-tab{flex:1;padding:13px;border:none;background:#f9f9f9;font-size:13px;font-weight:700;color:#888;cursor:pointer;font-family:inherit;transition:all .2s;border-bottom:2.5px solid transparent}
          .am-tab.active{background:#fff;color:#1a3a1e;border-bottom-color:#1a3a1e}
          .am-body{padding:20px 24px 24px}
          .am-back{background:none;border:none;color:#1a3a1e;font-size:13px;font-weight:700;cursor:pointer;padding:0;margin-bottom:16px;font-family:inherit}
          .am-sec-title{font-family:'Playfair Display',serif;font-size:20px;color:#1a3a1e;margin-bottom:16px}
          .am-greeting{font-family:'Playfair Display',serif;font-size:17px;color:#1a1a1a;font-weight:700;margin-bottom:3px}
          .am-greeting-sub{font-size:12px;color:#888;margin-bottom:16px}
          .am-google{width:100%;padding:12px;border:1.5px solid #e0e0e0;border-radius:10px;background:#fff;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;font-family:inherit;transition:all .2s;color:#333;margin-bottom:0}
          .am-google:hover{border-color:#1a3a1e;background:#f9fdf9}
          .am-divider{text-align:center;position:relative;margin:14px 0}
          .am-divider::before{content:'';position:absolute;top:50%;left:0;right:0;height:1px;background:#eee}
          .am-divider span{background:#fff;padding:0 12px;font-size:11px;color:#bbb;position:relative;font-weight:600}
          .am-field{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}
          .am-inp-err{border-color:#e74c3c!important;background:#fff9f9}
          .am-field-err{font-size:11px;color:#e74c3c;font-weight:700;margin-top:2px}
          .am-lbl{font-size:10px;font-weight:800;color:#888;text-transform:uppercase;letter-spacing:.5px}
          .am-inp{padding:11px 14px;border:1.5px solid #e0e0e0;border-radius:10px;font-size:14px;font-family:inherit;color:#1a1a1a;transition:border-color .2s;outline:none;width:100%;box-sizing:border-box}
          .am-inp:focus{border-color:#1a3a1e}
          .am-fp-link{position:absolute;right:0;top:0;background:none;border:none;font-size:11px;color:#1a3a1e;cursor:pointer;font-weight:700;font-family:inherit}
          .am-err{background:#fdecea;border:1px solid #f5c6cb;border-radius:8px;padding:9px 13px;font-size:12px;color:#c0392b;font-weight:700;margin-bottom:10px}
          .am-success{background:#e8f5e9;border:1px solid #c8e6c9;border-radius:8px;padding:9px 13px;font-size:12px;color:#2d6a4f;font-weight:700;margin-bottom:10px}
          .am-submit{width:100%;padding:13px;background:linear-gradient(135deg,#1a3a1e,#2d5233);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:800;cursor:pointer;font-family:inherit;transition:all .2s;margin-bottom:12px;letter-spacing:.2px}
          .am-submit:hover:not(:disabled){background:linear-gradient(135deg,#2d5233,#3a7042)}
          .am-submit:disabled{opacity:.6;cursor:not-allowed}
          .am-switch{font-size:12px;color:#888;text-align:center;margin-bottom:16px}
          .am-switch-btn{background:none;border:none;color:#1a3a1e;font-weight:800;cursor:pointer;font-family:inherit;font-size:12px}
          .am-ql-wrap{border-top:1px solid #f0f0f0;padding-top:16px;margin-top:8px;display:flex;flex-direction:column;gap:2px}
          .am-ql-item{display:flex;align-items:center;gap:12px;padding:10px 8px;border-radius:10px;cursor:pointer;transition:background .15s}
          .am-ql-item:hover{background:#f9fdf9}
          .am-ql-icon{font-size:20px;width:32px;text-align:center;flex-shrink:0}
          .am-ql-lbl{font-size:13px;font-weight:700;color:#1a1a1a}
          .am-ql-sub{font-size:11px;color:#888}
          .am-ql-arr{margin-left:auto;color:#bbb;font-size:20px}
        `}</style>
      </div>
    </div>
  )
}
