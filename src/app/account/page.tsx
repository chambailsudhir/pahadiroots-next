'use client'
// ─────────────────────────────────────────────────────────────
// AccountPage — lean orchestrator
//  ✅ CSS Module (no inline styles)
//  ✅ Auth state machine (guest/loading/authenticated/expired/failed)
//  ✅ Session expired banner
//  ✅ All logic delegated to hooks + sections
// ─────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useMemo } from 'react'
import { useAuth }       from './hooks/useAuth'
import { useUIStore }    from '@/store/uiStore'
import { useOrders }     from './hooks/useOrders'
import { useProfile }    from './hooks/useProfile'
import { useToast }      from './hooks/useToast'
import Sidebar           from './_components/Sidebar'
import OrdersSection     from './_sections/OrdersSection'
import AddressSection    from './_sections/AddressSection'
import ProfileSection    from './_sections/ProfileSection'
import PasswordSection   from './_sections/PasswordSection'
import { getSavedAddresses } from '@/lib/account/utils'
import type { SavedAddress } from './hooks/useProfile'
import styles from './styles/account.module.css'

type Tab = 'orders' | 'addresses' | 'profile' | 'password'

export default function AccountPage() {
  const [tab, setTab]      = useState<Tab>('orders')
  const { toast, toastType, show: showToast } = useToast()
  const { openAuth }       = useUIStore()
  const auth               = useAuth()
  const orders             = useOrders(auth.markExpired)
  const profile            = useProfile(auth.profile, auth.updateLocalProfile, showToast, auth.markExpired)

  const savedAddrs = useMemo(
    () => getSavedAddresses(auth.profile) as SavedAddress[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auth.profile?.saved_addresses]
  )

  const profileInitialised = useRef(false)

  // Auth init — single API call
  useEffect(() => { auth.init() }, [])

  // Populate forms once — only on the first time auth.profile arrives.
  // Previously this effect watched auth.profile, which gets a new object reference
  // on every optimistic update (saveName/saveAddress call updateLocalProfile).
  // That caused the effect to re-fire mid-edit, wiping form fields back to server values.
  // The ref guard ensures initFromProfile runs exactly once per page mount.
  useEffect(() => {
    if (auth.profile && !profileInitialised.current) {
      profile.initFromProfile(auth.profile)
      profileInitialised.current = true
    }
  }, [auth.profile])

  // Trigger order fetch after auth confirmed
  useEffect(() => {
    if (auth.loggedIn && !orders.hasFetched) orders.fetchOrders()
  }, [auth.loggedIn, orders.hasFetched])

  // ── Loading ───────────────────────────────────────────────
  if (!auth.loaded) return (
    <div className={styles.accLoading}>
      <div className={styles.accSpinner} />
      <p className={styles.loadingText}>Loading your account…</p>
    </div>
  )

  // ── API error ─────────────────────────────────────────────
  if (auth.authState === 'failed') return (
    <div className={styles.accWrap}>
      <div className={styles.loginWall}>
        <div className={styles.lwIcon}>⚠️</div>
        <div className={styles.lwTitle}>Something went wrong</div>
        <p className={styles.lwSub}>Could not connect. Please check your connection and try again.</p>
        <button className={styles.btnPrimary} onClick={() => window.location.reload()}>Try Again</button>
      </div>
    </div>
  )

  // ── Guest (not logged in) ─────────────────────────────────
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

  const NAV_TABS = [
    { key: 'orders'    as const, icon: '📦', label: 'Orders'   },
    { key: 'addresses' as const, icon: '📍', label: 'Addresses'},
    { key: 'profile'   as const, icon: '👤', label: 'Profile'  },
    { key: 'password'  as const, icon: '🔒', label: 'Password' },
  ]

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
        <Sidebar
          tab={tab}
          setTab={setTab}
          profile={auth.profile}
          authUser={auth.authUser}
          stats={orders.stats}
          onLogout={auth.logout}
          onOrdersClick={() => { if (!orders.hasFetched) orders.fetchOrders() }}
        />

        <div className={styles.mainPanel}>
          {tab === 'orders'    && <OrdersSection   orders={orders} showToast={showToast} />}
          {tab === 'addresses' && <AddressSection  authProfile={auth.profile} profile={profile} savedAddrs={savedAddrs} onEditAddress={() => setTab('profile')} />}
          {tab === 'profile'   && <ProfileSection  authProfile={auth.profile} authUser={auth.authUser} profile={profile} />}
          {tab === 'password'  && <PasswordSection profile={profile} />}
        </div>
      </div>

      {/* Mobile tabs */}
      <div className={styles.mobTabs}>
        {NAV_TABS.map(it => (
          <button
            key={it.key}
            className={`${styles.mobTab}${tab === it.key ? ' ' + styles.mobTabActive : ''}`}
            onClick={() => { setTab(it.key); if (it.key === 'orders' && !orders.hasFetched) orders.fetchOrders() }}
          >
            <span className={styles.mtIcon}>{it.icon}</span>
            {it.label}
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
