'use client'

import { useState } from 'react'
import { useUIStore } from '@/store/uiStore'
import { useUserStore } from '@/store/userStore'
import { supabase } from '@/lib/supabase'

type AuthTab = 'email' | 'phone'
type AuthStep = 'input' | 'otp'

export default function AuthModal() {
  const { isAuthOpen, closeAuth } = useUIStore()
  const setUser = useUserStore(s => s.setUser)

  const [tab,     setTab]     = useState<AuthTab>('email')
  const [step,    setStep]    = useState<AuthStep>('input')
  const [email,   setEmail]   = useState('')
  const [phone,   setPhone]   = useState('')
  const [otp,     setOtp]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [msg,     setMsg]     = useState<string | null>(null)

  if (!isAuthOpen) return null

  async function handleSendOtp() {
    setError(null)
    setLoading(true)
    try {
      if (tab === 'email') {
        const { error: err } = await supabase.auth.signInWithOtp({ email })
        if (err) throw err
        setMsg('Check your email for a magic link.')
        setStep('otp')
      } else {
        const formatted = phone.startsWith('+') ? phone : `+91${phone.replace(/\D/g, '')}`
        const { error: err } = await supabase.auth.signInWithOtp({ phone: formatted })
        if (err) throw err
        setMsg('Enter the OTP sent to your phone.')
        setStep('otp')
      }
    } catch (e: any) {
      setError(e.message || 'Failed to send OTP')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyOtp() {
    setError(null)
    setLoading(true)
    try {
      const formatted = phone.startsWith('+') ? phone : `+91${phone.replace(/\D/g, '')}`
      const { data, error: err } = tab === 'email'
        ? await supabase.auth.verifyOtp({ email, token: otp, type: 'email' })
        : await supabase.auth.verifyOtp({ phone: formatted, token: otp, type: 'sms' })
      if (err) throw err
      if (data.user) {
        setUser({
          id:    data.user.id,
          phone: data.user.phone || '',
          email: data.user.email,
          name:  data.user.user_metadata?.name,
        })
        closeAuth()
      }
    } catch (e: any) {
      setError(e.message || 'Invalid OTP')
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setStep('input')
    setOtp('')
    setError(null)
    setMsg(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={closeAuth}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 sm:p-8">
        {/* Close */}
        <button
          onClick={closeAuth}
          className="absolute top-4 right-4 text-stone-400 hover:text-stone-600 transition-colors"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className="text-2xl font-bold text-stone-900 mb-1">Sign in</h2>
        <p className="text-sm text-stone-500 mb-6">Access your Pahadi Roots account</p>

        {/* Tabs */}
        {step === 'input' && (
          <div className="flex border border-stone-200 rounded-lg p-1 mb-6">
            {(['email', 'phone'] as AuthTab[]).map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setError(null) }}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors capitalize ${
                  tab === t
                    ? 'bg-forest-700 text-white'
                    : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                {t === 'email' ? '📧 Email' : '📱 Phone'}
              </button>
            ))}
          </div>
        )}

        {/* Error / Message */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}
        {msg && (
          <div className="mb-4 p-3 bg-forest-50 border border-forest-200 rounded-lg text-sm text-forest-700">
            {msg}
          </div>
        )}

        {step === 'input' ? (
          <div className="space-y-4">
            {tab === 'email' ? (
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
              />
            ) : (
              <div className="flex">
                <span className="inline-flex items-center px-3 border border-r-0 border-stone-200 rounded-l-xl bg-stone-50 text-stone-500 text-sm">
                  +91
                </span>
                <input
                  type="tel"
                  placeholder="9876543210"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  maxLength={10}
                  className="flex-1 px-4 py-3 border border-stone-200 rounded-r-xl text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
                />
              </div>
            )}
            <button
              onClick={handleSendOtp}
              disabled={loading || (tab === 'email' ? !email : phone.replace(/\D/g,'').length < 10)}
              className="w-full py-3 bg-forest-700 text-white font-semibold rounded-xl hover:bg-forest-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Sending…' : 'Continue'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Enter OTP"
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
              maxLength={6}
              className="w-full px-4 py-3 border border-stone-200 rounded-xl text-sm text-center tracking-widest text-lg focus:outline-none focus:ring-2 focus:ring-forest-500"
            />
            <button
              onClick={handleVerifyOtp}
              disabled={loading || otp.length < 6}
              className="w-full py-3 bg-forest-700 text-white font-semibold rounded-xl hover:bg-forest-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Verifying…' : 'Verify OTP'}
            </button>
            <button
              onClick={reset}
              className="w-full text-sm text-stone-500 hover:text-stone-700 transition-colors"
            >
              ← Back
            </button>
          </div>
        )}

        <p className="mt-6 text-xs text-stone-400 text-center">
          By continuing you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  )
}
