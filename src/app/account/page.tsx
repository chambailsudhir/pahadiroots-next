'use client'
// ─────────────────────────────────────────────────────────────
// AccountPage — orchestrator with loyalty tab added
// ─────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useMemo, Suspense, type JSX } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { useAuth }       from './hooks/useAuth'
import { useUIStore }    from '@/store/uiStore'
import { useUserStore, selectHasHydrated } from '@/store/userStore'
import { useOrders }     from './hooks/useOrders'
import { useProfile }    from './hooks/useProfile'
import { useToast }      from './hooks/useToast'
import Sidebar           from './_components/Sidebar'
import { ACCOUNT_PANEL_ID, sidebarTabId, mobileTabId, onTabKeyDown } from './_components/tabNav'
import type { Tab }      from './_components/Sidebar'
import OrdersSection     from './_sections/OrdersSection'
import AddressSection    from './_sections/AddressSection'
import ProfileSection    from './_sections/ProfileSection'
import PasswordSection   from './_sections/PasswordSection'
import NotificationsSection from './_sections/NotificationsSection'
import DangerZoneSection from './_sections/DangerZoneSection'
import LoyaltySection    from './_sections/LoyaltySection'
import { getSavedAddresses } from '@/lib/account/utils'
import { VERIFY_NOTICE_KEY, VERIFY_NOTICE_EVENT, type VerifyNotice } from '@/app/reset-password/resetPasswordHelpers'
import type { SavedAddress } from '@/lib/account/utils'
import styles from './styles/account.module.css'
import Icon from '@/components/ui/Icon'

const VALID_TABS: Tab[] = ['orders', 'addresses', 'profile', 'password', 'notifications', 'privacy', 'loyalty']

// BUG FIX (react-hooks/exhaustive-deps): was defined inside AccountPageInner,
// recreated with a new reference on every render even though it has no
// closure over any component state — it's a pure function of its
// parameter. Moved to module scope so it has a permanently stable
// reference, the same fix-shape as memoizing useToast's `show` and
// useOrders' `fetchOrders`/`refresh` above, just achieved by relocation
// instead of useCallback since no closure is needed at all.
function getProfileSig(p: { first_name?: string | null; last_name?: string | null; address_line1?: string | null; city?: string | null; state?: string | null; pincode?: string | null; postal_code?: string | null; phone?: string | null }): string {
  return [
    p.first_name, p.last_name,
    p.address_line1, p.city, p.state, p.pincode ?? p.postal_code,
    p.phone,
  ].join('\x00')
}

function AccountPageInner() {
  const searchParams = useSearchParams()
  const router       = useRouter()

  // E-mail verification result, decided by GoogleAuthHandler from the hash it actually received (not from a spoofable URL flag).
  // The handler lives in the root layout, so its effect runs AFTER this page's: read what it already stored, and listen for it.
  const [verifyNotice, setVerifyNotice] = useState<VerifyNotice | null>(null)
  useEffect(() => {
    const take = (v: unknown) => { if (v === 'ok' || v === 'expired') setVerifyNotice(v) }
    try { take(sessionStorage.getItem(VERIFY_NOTICE_KEY)) } catch { /* storage blocked */ }
    const onNotice = (e: Event) => take((e as CustomEvent).detail)
    window.addEventListener(VERIFY_NOTICE_EVENT, onNotice)
    return () => window.removeEventListener(VERIFY_NOTICE_EVENT, onNotice)
  }, [])

  const urlTab   = searchParams.get('tab') as Tab | null
  const [tab, setTabState] = useState<Tab>(
    urlTab && VALID_TABS.includes(urlTab) ? urlTab : 'orders'
  )

  // AUDIT E1-11: a <Link href="/account?tab=…"> clicked while already on /account changes the URL but the tab state
  // was only seeded on first mount. Follow later URL changes (adjusting state during render, no effect needed).
  const [seenUrlTab, setSeenUrlTab] = useState<Tab | null>(urlTab)
  if (urlTab !== seenUrlTab) {
    setSeenUrlTab(urlTab)
    if (urlTab && VALID_TABS.includes(urlTab) && urlTab !== tab) setTabState(urlTab)
  }

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

  // auth.init is memoized in useAuth.ts (useCallback, stable deps:
  // syncStore, storeSetWishlist — both themselves stable). The rule wants
  // the whole `auth` object even though only this stable property is used;
  // `auth` itself is a new object literal every render, so depending on it
  // would cause this effect to re-run on every unrelated render. Safe to
  // disable: init() is itself guarded by an internal initDone ref, so even
  // an extra re-run would be a no-op, not a real bug — this disable avoids
  // the unnecessary re-evaluation entirely.
  // AUDIT E1-5: the persisted user store is rehydrated in a setTimeout(0) after mount (providers.tsx). init() reads
  // the store user, so running it before hydration made a logged-in user flash "Welcome Back / Sign In" as a guest.
  const storeHydrated = useUserStore(selectHasHydrated)
  // Keep the selected tab of the horizontally scrolling mobile bar in view (deep links like ?tab=privacy).
  useEffect(() => {
    document.getElementById(mobileTabId(tab))?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
  }, [tab])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (storeHydrated) auth.init() }, [storeHydrated, auth.init])

  useEffect(() => {
    if (!auth.profile) return
    const sig = getProfileSig(auth.profile)
    // Re-init on first load OR when server-side fields change mid-session.
    if (!profileInitialised.current) {
      profile.initFromProfile(auth.profile)
      profileInitialised.current = true
      profileSig.current         = sig
    } else if (sig !== profileSig.current) {
      // AUDIT E1-3: only fields that changed externally are copied into the form — our own optimistic saves and
      // rollbacks must not reset (and so discard) edits the user is making in the other cards.
      profile.syncFromProfile(auth.profile)
      profileSig.current = sig
    }
    // getProfileSig is module-scope (stable, no closure) — doesn't need to
    // be listed. profile.initFromProfile is memoized in useProfile.ts
    // (empty deps). The rule still wants the whole `profile` object, which
    // is a new literal every render — depending on it would re-run this
    // effect constantly. Safe to disable: the profileInitialised/profileSig
    // ref guard already makes re-runs a no-op unless the profile signature
    // actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.profile, profile.initFromProfile, profile.syncFromProfile])

  // orders.fetchOrders is memoized in useOrders.ts (useCallback, empty
  // deps). The rule still wants the whole `orders` object (a new literal
  // every render) — depending on it would re-run this effect constantly.
  // Safe to disable: fetchOrders() just flips a boolean that's already
  // checked via hasFetched, so a re-run is a no-op once orders are loaded.
  useEffect(() => {
    if (auth.loggedIn && !orders.hasFetched) orders.fetchOrders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.loggedIn, orders.hasFetched, orders.fetchOrders])

  // AUDIT E1-4: logout reports failure instead of pretending the server session was cleared.
  async function handleLogout() {
    const ok = await auth.logout()
    if (!ok) showToast("Couldn't sign you out – try again", 'error')
  }

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
      {auth.expired && (
        <div className={styles.sessionBanner} role="alert">
          <Icon name="warning" /> Your session has expired.
          <button className={styles.sessionBannerBtn} onClick={openAuth}>Login Again</button>
        </div>
      )}
      <div className={styles.loginWall}>
        <div className={styles.lwIcon}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        </div>
        {verifyNotice === 'ok' && (
          <p role="status" style={{ background: '#e8f5e9', color: '#1b5e20', border: '1px solid #a5d6a7', borderRadius: 10, padding: '10px 14px', margin: '0 0 12px', fontSize: 14 }}>
            Your e-mail is verified. Please sign in to continue.
          </p>
        )}
        {verifyNotice === 'expired' && (
          <p role="alert" style={{ background: '#fff8e1', color: '#7a5200', border: '1px solid #ffe082', borderRadius: 10, padding: '10px 14px', margin: '0 0 12px', fontSize: 14 }}>
            That verification link has expired or was already used. Try signing in; if it says your e-mail is not confirmed, use “Forgot password” to get a fresh link.
          </p>
        )}
        <h1 className={styles.lwTitle}>Welcome Back</h1>
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

  const selectTab = (k: Tab) => { navigateTo(k); if (k === 'orders' && !orders.hasFetched) orders.fetchOrders() }

  const userEmail = auth.authUser?.email || auth.profile?.email || ''

  return (
    <div className={styles.accWrap}>

      {auth.expired && (
        <div className={styles.sessionBanner}>
          <Icon name="warning" /> Your session has expired.
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
          onLogout={handleLogout}
          onOrdersClick={() => { if (!orders.hasFetched) orders.fetchOrders() }}
        />

        <div className={styles.mainPanel} role="tabpanel" id={ACCOUNT_PANEL_ID} aria-labelledby={sidebarTabId(tab)}>
          {tab === 'orders'        && <OrdersSection   orders={orders} showToast={showToast} />}
          {tab === 'loyalty'       && <LoyaltySection  showToast={showToast} markExpired={auth.markExpired} />}
          {tab === 'addresses'     && <AddressSection  authProfile={auth.profile} profile={profile} savedAddrs={savedAddrs} onEditAddress={() => navigateTo('profile')} />}
          {tab === 'profile'       && <ProfileSection  authProfile={auth.profile} authUser={auth.authUser} profile={profile} />}
          {tab === 'password'      && <PasswordSection profile={profile} />}
          {tab === 'notifications' && <NotificationsSection showToast={showToast} markExpired={auth.markExpired} />}
          {tab === 'privacy'       && (
            <DangerZoneSection
              userEmail={String(userEmail)}
              onLogout={handleLogout}
              showToast={showToast}
              markExpired={auth.markExpired}
            />
          )}
        </div>
      </div>

      {/* Mobile bottom nav */}
      <nav aria-label="Account mobile navigation" className={styles.mobTabs}>
        <div className={styles.mobTabList}>
          {/* The tablist holds tabs only (the Wishlist LINK navigates elsewhere, so it sits beside it). It is the
              horizontally scrolling flex container itself — no `display: contents` wrapper, which loses roles in some browsers. */}
          <div role="tablist" aria-label="Account sections" aria-orientation="horizontal" className={styles.mobTabScroll}>
          {MOB_TABS.map(it => (
            <button
              key={it.key}
              type="button"
              role="tab"
              id={mobileTabId(it.key)}
              aria-selected={tab === it.key}
              aria-controls={ACCOUNT_PANEL_ID}
              tabIndex={tab === it.key ? 0 : -1}
              aria-label={it.label}
              className={`${styles.mobTab}${tab === it.key ? ' ' + styles.mobTabActive : ''}`}
              onClick={() => selectTab(it.key)}
              onKeyDown={e => onTabKeyDown(e, MOB_TABS.map(t => t.key), it.key, 'horizontal', selectTab)}
            >
              <span className={styles.mtIcon}>{NAV_ICONS[it.key]}</span>
              {it.label}
            </button>
          ))}
          </div>
          <Link prefetch={false} href="/wishlist" aria-label="My Wishlist" className={styles.mobTab}>
            <span className={styles.mtIcon}>{NAV_ICONS.wishlist}</span>
            Wishlist
          </Link>
        </div>
        {/* Sign out sits inside the nav landmark so keyboard/screen-reader users
            navigating by landmark reach it in the same context as the tab bar. */}
        <button
          className={styles.mobSignOut}
          onClick={handleLogout}
          disabled={auth.loggingOut}
          aria-busy={auth.loggingOut}
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
