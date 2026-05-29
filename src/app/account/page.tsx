'use client'
// ─────────────────────────────────────────────────────────────
// AccountPage — orchestrator with loyalty tab added
// ─────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useMemo, Suspense, type JSX } from 'react'
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
  // Track which version of the profile we last initialised from.
  // If the server-side fields change mid-session (e.g. pushed update from
  // another tab, or a failed optimistic save partially changed the store)
  // we re-init the form so the user always sees current data.
  const profileSig = useRef<string>('')

  function getProfileSig(p: NonNullable<typeof auth.profile>): string {
    return [
      p.first_name, p.last_name,
      p.address_line1, p.city, p.state, p.postal_code,
      p.phone,
    ].join('\x00')
  }

  useEffect(() => { auth.init() }, [])

  useEffect(() => {
    if (!auth.profile) return
    const sig = getProfileSig(auth.profile)
    // Re-init on first load OR when server-side fields change mid-session.
    if (!profileInitialised.current || sig !== profileSig.current) {
      profile.initFromProfile(auth.profile)
      profileInitialised.current = true
      profileSig.current         = sig
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
        <div className={styles.lwIcon}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <div className={styles.lwTitle}>Something went wrong</div>
        <p className={styles.lwSub}>Could not connect. Please check your connection and try again.</p>
        <button className={styles.btnPrimary} onClick={auth.retry}>Try Again</button>
      </div>
    </div>
  )

  if (!auth.loggedIn) return (
    <div className={styles.accWrap}>
      <div className={styles.loginWall}>
        <div className={styles.lwIcon}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        </div>
        <div className={styles.lwTitle}>Welcome Back</div>
        <p className={styles.lwSub}>Please login to view your orders and manage your account.</p>
        <button className={styles.btnPrimary} onClick={openAuth}>Sign In to Continue</button>
      </div>
    </div>
  )

  // SVG icons for mobile nav — consistent rendering across all OS/devices.
  // Emoji rendering varies wildly between Android 8 vs 13, and is blocked
  // on some corporate devices via font substitution.
  const NAV_ICONS: Record<Tab | 'wishlist', JSX.Element> = {
    orders:        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>,
    loyalty:       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
    addresses:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>,
    profile:       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    notifications: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>,
    password:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
    privacy:       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
    wishlist:      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>,
  }

  const MOB_TABS: { key: Tab; label: string }[] = [
    { key: 'orders',        label: 'Orders'    },
    { key: 'loyalty',       label: 'Coins'     },
    { key: 'addresses',     label: 'Addresses' },
    { key: 'profile',       label: 'Profile'   },
    { key: 'notifications', label: 'Alerts'    },
    { key: 'password',      label: 'Password'  },
    { key: 'privacy',       label: 'Privacy'   },
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
              <span className={styles.mtIcon}>{NAV_ICONS[it.key]}</span>
              {it.label}
            </button>
          ))}
          <Link href="/wishlist" aria-label="My Wishlist" className={styles.mobTab}>
            <span className={styles.mtIcon}>{NAV_ICONS.wishlist}</span>
            Wishlist
          </Link>
        </div>
        {/* Sign out sits inside the nav landmark so keyboard/screen-reader users
            navigating by landmark reach it in the same context as the tab bar. */}
        <button
          className={styles.mobSignOut}
          onClick={auth.logout}
          aria-label="Sign out of your account"
        >
          Sign out
        </button>
      </nav>

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
