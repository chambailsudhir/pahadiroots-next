'use client'
// ─────────────────────────────────────────────────────────────
// AccountPage — orchestrator with loyalty tab added
// ─────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { useAuth }       from './hooks/useAuth'
import { useUIStore }    from '@/store/uiStore'
import { useOrders }     from './hooks/useOrders'
import { useProfile }    from './hooks/useProfile'
import { useToast }      from './hooks/useToast'
import Sidebar           from './_components/Sidebar'
import type { Tab }      from './_components/Sidebar'
import OrdersSection     from './_sections/OrdersSection'
import AddressSection    from './_sections/AddressSection'
import ProfileSection    from './_sections/ProfileSection'
import PasswordSection   from './_sections/PasswordSection'
import NotificationsSection from './_sections/NotificationsSection'
import DangerZoneSection from './_sections/DangerZoneSection'
import LoyaltySection    from './_sections/LoyaltySection'
import { getSavedAddresses } from '@/lib/account/utils'
import type { SavedAddress } from '@/lib/account/utils'
import styles from './styles/account.module.css'

const VALID_TABS: Tab[] = ['orders', 'addresses', 'profile', 'password', 'notifications', 'privacy', 'loyalty']

function AccountPageInner() {
  const searchParams = useSearchParams()
  const router       = useRouter()

  const urlTab   = searchParams.get('tab') as Tab | null
  const [tab, setTabState] = useState<Tab>(
    urlTab && VALID_TABS.includes(urlTab) ? urlTab : 'orders'
  )

  function navigateTo(newTab: Tab) {
    setTabState(newTab)
    router.replace(`?tab=${newTab}`, { scroll: false })
  }

  const { toast, toastType, show: showToast } = useToast()
  const { openAuth }       = useUIStore()
  const auth               = useAuth()
  const orders             = useOrders(auth.markExpired)
  const profile            = useProfile(auth.profile, auth.updateLocalProfile, showToast, auth.markExpired)

  const savedAddrs = useMemo(
    () => getSavedAddresses(auth.profile),
    [auth.profile]
  )

  const profileInitialised = useRef(false)

  useEffect(() => { auth.init() }, [])

  useEffect(() => {
    if (auth.profile && !profileInitialised.current) {
      profile.initFromProfile(auth.profile)
      profileInitialised.current = true
    }
  }, [auth.profile])

  useEffect(() => {
    if (auth.loggedIn && !orders.hasFetched) orders.fetchOrders()
  }, [auth.loggedIn, orders.hasFetched])

  if (!auth.loaded) return (
    <div className={styles.accLoading}>
      <div className={styles.accSpinner} />
      <p className={styles.loadingText}>Loading your account…</p>
    </div>
  )

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

  const MOB_TABS: { key: Tab; icon: string; label: string }[] = [
    { key: 'orders',        icon: '📦', label: 'Orders'    },
    { key: 'loyalty',       icon: '🪙', label: 'Coins'     },
    { key: 'addresses',     icon: '📍', label: 'Addresses' },
    { key: 'profile',       icon: '👤', label: 'Profile'   },
    { key: 'notifications', icon: '🔔', label: 'Alerts'    },
    { key: 'password',      icon: '🔒', label: 'Password'  },
    { key: 'privacy',       icon: '🛡️', label: 'Privacy'   },
  ]

  const userEmail = auth.authUser?.email || auth.profile?.email || ''

  return (
    <div className={styles.accWrap}>

      {auth.expired && (
        <div className={styles.sessionBanner}>
          ⚠️ Your session has expired.
          <button className={styles.sessionBannerBtn} onClick={openAuth}>Login Again</button>
        </div>
      )}

      <div className={styles.accPage}>
        <Sidebar
          tab={tab}
          setTab={navigateTo}
          profile={auth.profile}
          authUser={auth.authUser}
          stats={orders.stats}
          onLogout={auth.logout}
          onOrdersClick={() => { if (!orders.hasFetched) orders.fetchOrders() }}
        />

        <div className={styles.mainPanel}>
          {tab === 'orders'        && <OrdersSection   orders={orders} showToast={showToast} />}
          {tab === 'loyalty'       && <LoyaltySection  showToast={showToast} />}
          {tab === 'addresses'     && <AddressSection  authProfile={auth.profile} profile={profile} savedAddrs={savedAddrs} onEditAddress={() => navigateTo('profile')} />}
          {tab === 'profile'       && <ProfileSection  authProfile={auth.profile} authUser={auth.authUser} profile={profile} />}
          {tab === 'password'      && <PasswordSection profile={profile} />}
          {tab === 'notifications' && <NotificationsSection showToast={showToast} markExpired={auth.markExpired} />}
          {tab === 'privacy'       && (
            <DangerZoneSection
              userEmail={String(userEmail)}
              onLogout={auth.logout}
              showToast={showToast}
              markExpired={auth.markExpired}
            />
          )}
        </div>
      </div>

      {/* Mobile bottom nav */}
      <nav aria-label="Account mobile navigation" className={styles.mobTabs}>
        <div role="tablist" aria-label="Account sections" className={styles.mobTabList}>
          {MOB_TABS.map(it => (
            <button
              key={it.key}
              role="tab"
              aria-selected={tab === it.key}
              aria-label={it.label}
              className={`${styles.mobTab}${tab === it.key ? ' ' + styles.mobTabActive : ''}`}
              onClick={() => { navigateTo(it.key); if (it.key === 'orders' && !orders.hasFetched) orders.fetchOrders() }}
            >
              <span className={styles.mtIcon} aria-hidden="true">{it.icon}</span>
              {it.label}
            </button>
          ))}
          <Link href="/wishlist" aria-label="My Wishlist" className={styles.mobTab}>
            <span className={styles.mtIcon} aria-hidden="true">❤️</span>
            Wishlist
          </Link>
        </div>
      </nav>

      <button
        className={styles.mobSignOut}
        onClick={auth.logout}
        aria-label="Sign out of your account"
      >
        Sign out
      </button>

      {/* Toast */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={
          toast
            ? `${styles.accToast}${toastType === 'error' ? ' ' + styles.accToastError : ''}`
            : styles.toastHidden
        }
      >
        {toast || ''}
      </div>
    </div>
  )
}

function AccountPageFallback() {
  return (
    <div className={styles.accLoading}>
      <div className={styles.accSpinner} />
      <p className={styles.loadingText}>Loading your account…</p>
    </div>
  )
}

export default function AccountPage() {
  return (
    <Suspense fallback={<AccountPageFallback />}>
      <AccountPageInner />
    </Suspense>
  )
}
