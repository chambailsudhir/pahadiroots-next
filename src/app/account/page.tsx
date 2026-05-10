'use client'
// ─────────────────────────────────────────────────────────────
// AccountPage — orchestrator only (~100 lines)
//
//  ✅ No inline styles — uses account.module.css
//  ✅ No business logic — delegated to hooks + sections
//  ✅ Auth state machine (idle/loading/authenticated/expired)
//  ✅ Session expired banner with re-login CTA
//  ✅ Suspense-ready section structure
// ─────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo, useRef } from 'react'
import { useAuth }     from './hooks/useAuth'
import { useUIStore }  from '@/store/uiStore'
import { useOrders }   from './hooks/useOrders'
import { useProfile }  from './hooks/useProfile'
import Sidebar          from './_components/Sidebar'
import OrdersSection    from './_sections/OrdersSection'
import AddressSection   from './_sections/AddressSection'
import ProfileSection   from './_sections/ProfileSection'
import PasswordSection  from './_sections/PasswordSection'
import { getSavedAddresses } from '@/lib/account/utils'
import type { SavedAddress } from './hooks/useProfile'
import styles from './styles/account.module.css'

type Tab = 'orders' | 'addresses' | 'profile' | 'password'

function useToast() {
  const [toast,     setToast]     = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function show(msg: string, type: 'success' | 'error' = 'success') {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast(msg); setToastType(type)
    timerRef.current = setTimeout(() => setToast(''), 3500)
  }
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
  return { toast, toastType, show }
}

export default function AccountPage() {
  const [tab, setTab] = useState<Tab>('orders')
  const { toast, toastType, show: showToast } = useToast()
  const { openAuth } = useUIStore()
  const auth    = useAuth()
  const orders  = useOrders()
  const profile = useProfile(auth.profile, auth.updateLocalProfile, showToast)

  const savedAddrsRaw  = auth.profile?.saved_addresses ?? ''
  const savedAddrs     = useMemo(() => getSavedAddresses(auth.profile) as SavedAddress[], [savedAddrsRaw])

  // Auth init
  useEffect(() => { auth.init() }, [])

  // Populate forms when profile loads
  useEffect(() => { if (auth.profile) profile.initFromProfile(auth.profile) }, [auth.profile])

  // Auto-fetch orders on login
  useEffect(() => {
    if (auth.loggedIn && !orders.hasFetched && !orders.loading) orders.fetchOrders()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.loggedIn, orders.hasFetched, orders.loading, orders.fetchOrders])

  // ── Loading ───────────────────────────────────────────────
  if (!auth.loaded) return (
    <div className={styles.accLoading}>
      <div className={styles.accSpinner} />
      <p className={styles.loadingText}>Loading your account…</p>
    </div>
  )

  // ── Not logged in ─────────────────────────────────────────
  if (!auth.loggedIn) return (
    <div className={styles.accWrap}>
      <div className={styles.loginWall}>
        <div className={styles.lwIcon}>🔐</div>
        <div className={styles.lwTitle}>Welcome Back</div>
        <p className={styles.lwSub}>Please login to view your orders and manage your account.</p>
        <button className={styles.btnPrimary} onClick={openAuth}>Sign In to Continue</button>
      </div>
    </div>
  )

  return (
    <div className={styles.accWrap}>

      {/* Session expired banner */}
      {auth.expired && (
        <div className={styles.sessionBanner}>
          ⚠️ Your session has expired.
          <button className={styles.sessionBannerBtn} onClick={openAuth}>Login Again</button>
        </div>
      )}

      <div className={styles.accPage}>

        {/* Sidebar */}
        <Sidebar
          tab={tab}
          setTab={setTab}
          profile={auth.profile}
          authUser={auth.authUser}
          stats={orders.stats}
          onLogout={auth.logout}
          onOrdersClick={() => { if (!orders.hasFetched && !orders.loading) orders.fetchOrders() }}
        />

        {/* Main Panel */}
        <div className={styles.mainPanel}>
          {tab === 'orders'    && <OrdersSection   orders={orders} showToast={showToast} />}
          {tab === 'addresses' && <AddressSection  authProfile={auth.profile} profile={profile} savedAddrs={savedAddrs} onEditAddress={() => setTab('profile')} />}
          {tab === 'profile'   && <ProfileSection  authProfile={auth.profile} authUser={auth.authUser} profile={profile} />}
          {tab === 'password'  && <PasswordSection profile={profile} />}
        </div>

      </div>

      {/* Mobile nav */}
      <div className={styles.mobTabs}>
        {([
          { key: 'orders',    icon: '📦', label: 'Orders'    },
          { key: 'addresses', icon: '📍', label: 'Addresses' },
          { key: 'profile',   icon: '👤', label: 'Profile'   },
          { key: 'password',  icon: '🔒', label: 'Password'  },
        ] as const).map(it => (
          <button key={it.key}
            className={`${styles.mobTab}${tab === it.key ? ' ' + styles.mobTabActive : ''}`}
            onClick={() => { setTab(it.key); if (it.key === 'orders' && !orders.hasFetched && !orders.loading) orders.fetchOrders() }}
          >
            <span className={styles.mtIcon}>{it.icon}</span>{it.label}
          </button>
        ))}
        <button className={styles.mobTab} onClick={auth.logout}>
          <span className={styles.mtIcon}>🚪</span>Logout
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`${styles.accToast}${toastType === 'error' ? ' ' + styles.accToastError : ''}`}>
          {toast}
        </div>
      )}
    </div>
  )
}
