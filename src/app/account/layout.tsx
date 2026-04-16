'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useUserStore } from '@/store/userStore'
import { supabase } from '@/lib/supabase'

const NAV_ITEMS = [
  { href: '/account',           label: 'Dashboard',  icon: '🏠' },
  { href: '/account/orders',    label: 'My Orders',  icon: '📦' },
  { href: '/account/addresses', label: 'Addresses',  icon: '📍' },
  { href: '/account/wishlist',  label: 'Wishlist',   icon: '❤️' },
]

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const user      = useUserStore(s => s.user)
  const setUser   = useUserStore(s => s.setUser)
  const logout    = useUserStore(s => s.logout)
  const router    = useRouter()
  const pathname  = usePathname()

  const [phone,    setPhone]    = useState('')
  const [otp,      setOtp]      = useState('')
  const [step,     setStep]     = useState<'phone' | 'otp'>('phone')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  async function sendOTP() {
    if (!/^[6-9]\d{9}$/.test(phone)) {
      setError('Enter a valid 10-digit mobile number')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: `+91${phone}`,
      })
      if (error) throw error
      setStep('otp')
    } catch (err: any) {
      setError(err.message || 'Failed to send OTP')
    } finally {
      setLoading(false)
    }
  }

  async function verifyOTP() {
    if (otp.length < 6) { setError('Enter the 6-digit OTP'); return }
    setLoading(true)
    setError('')
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        phone: `+91${phone}`,
        token: otp,
        type:  'sms',
      })
      if (error) throw error
      if (data.user) {
        setUser({ id: data.user.id, phone })
      }
    } catch (err: any) {
      setError(err.message || 'Invalid OTP')
    } finally {
      setLoading(false)
    }
  }

  if (!user) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="text-4xl mb-3">👤</div>
            <h1 className="text-2xl font-bold text-stone-900 mb-1">Sign In</h1>
            <p className="text-stone-500 text-sm">Enter your mobile number to continue</p>
          </div>

          <div className="bg-white border border-stone-200 rounded-2xl p-6 space-y-4">
            {step === 'phone' ? (
              <>
                <div>
                  <label className="block text-xs font-semibold text-stone-600 mb-1">Mobile Number</label>
                  <div className="flex">
                    <span className="flex items-center bg-stone-50 border border-r-0 border-stone-200 rounded-l-xl px-3 text-sm text-stone-500">
                      +91
                    </span>
                    <input
                      type="tel"
                      value={phone}
                      onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      placeholder="98765 43210"
                      className="flex-1 border border-stone-200 rounded-r-xl px-3 py-2.5 text-sm outline-none focus:border-forest-500"
                    />
                  </div>
                </div>
                {error && <p className="text-xs text-red-500">{error}</p>}
                <button
                  onClick={sendOTP}
                  disabled={loading}
                  className="w-full bg-forest-700 hover:bg-forest-800 text-white font-bold py-3 rounded-xl text-sm transition-colors disabled:opacity-60"
                >
                  {loading ? 'Sending OTP…' : 'Send OTP'}
                </button>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-semibold text-stone-600 mb-1">
                    Enter OTP sent to +91 {phone}
                  </label>
                  <input
                    type="number"
                    value={otp}
                    onChange={e => setOtp(e.target.value.slice(0, 6))}
                    placeholder="123456"
                    className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-forest-500 font-mono text-center text-lg tracking-widest"
                  />
                </div>
                {error && <p className="text-xs text-red-500">{error}</p>}
                <button
                  onClick={verifyOTP}
                  disabled={loading}
                  className="w-full bg-forest-700 hover:bg-forest-800 text-white font-bold py-3 rounded-xl text-sm transition-colors disabled:opacity-60"
                >
                  {loading ? 'Verifying…' : 'Verify OTP'}
                </button>
                <button
                  onClick={() => { setStep('phone'); setOtp(''); setError('') }}
                  className="w-full text-xs text-stone-400 hover:text-stone-600 transition-colors"
                >
                  ← Change number
                </button>
              </>
            )}
          </div>

          <p className="text-center text-xs text-stone-400 mt-4">
            No password needed. We'll send a one-time OTP.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col sm:flex-row gap-6">

        {/* Sidebar */}
        <aside className="sm:w-52 shrink-0">
          <div className="bg-stone-50 rounded-2xl p-4">
            <div className="mb-4 pb-4 border-b border-stone-200">
              <div className="text-sm font-bold text-stone-800">{user.name || 'My Account'}</div>
              <div className="text-xs text-stone-400 mt-0.5">+91 {user.phone}</div>
            </div>
            <nav className="space-y-1">
              {NAV_ITEMS.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2.5 text-sm px-3 py-2 rounded-xl transition-colors ${
                    pathname === item.href
                      ? 'bg-forest-700 text-white font-semibold'
                      : 'text-stone-600 hover:bg-stone-200'
                  }`}
                >
                  <span>{item.icon}</span>
                  {item.label}
                </Link>
              ))}
              <button
                onClick={() => { logout(); supabase.auth.signOut() }}
                className="flex items-center gap-2.5 text-sm px-3 py-2 rounded-xl text-stone-500 hover:bg-red-50 hover:text-red-600 w-full text-left transition-colors mt-2"
              >
                <span>🚪</span> Sign Out
              </button>
            </nav>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  )
}
