'use client'
import React from 'react'
import Link from 'next/link'
import { getInitials, formatCurrency } from '@/lib/account/utils'
import { type Profile, type AuthUser } from '../hooks/useAuth'
import styles from '../styles/account.module.css'

export type Tab = 'orders' | 'addresses' | 'profile' | 'password' | 'notifications' | 'privacy' | 'loyalty'

interface Props {
  tab:           Tab
  setTab:        (t: Tab) => void
  profile:       Profile | null
  authUser:      AuthUser | null
  stats:         { total: number; delivered: number; active: number; spent: number; loyalty_points?: number } | null
  onLogout:      () => void
  onOrdersClick: () => void
}

export default function Sidebar({ tab, setTab, profile, authUser, stats, onLogout, onOrdersClick }: Props) {
  const userMeta  = authUser?.user_metadata ?? {}
  const firstName = profile?.first_name || (typeof userMeta.full_name === 'string' ? userMeta.full_name.split(' ')[0] : '') || 'User'
  const fullName  = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || firstName
  const email     = authUser?.email || profile?.email || ''
  const phone     = (profile?.phone || authUser?.phone || '').replace(/^\+91/, '')
  const initials  = getInitials(fullName)
  const since     = profile?.created_at
    ? new Date(profile.created_at as string).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
    : null

  const loyaltyPts = stats?.loyalty_points ?? 0
  const coinsLabel = loyaltyPts >= 99_500
    ? '99k+'
    : loyaltyPts >= 1000
    ? `${(loyaltyPts / 1000).toFixed(1)}k`
    : String(loyaltyPts)

  // SVG icons — consistent across JAWS, NVDA, and MDM-locked devices (emoji rendering varies)
  const NAV: { key: Tab; icon: React.ReactNode; label: string; badge?: number | null }[] = [
    { key: 'orders',        icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>, label: 'My Orders', badge: stats?.active || null },
    { key: 'loyalty',       icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>, label: 'Pahadi Coins', badge: loyaltyPts > 0 ? loyaltyPts : null },
    { key: 'addresses',     icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>, label: 'Addresses' },
    { key: 'profile',       icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>, label: 'Profile' },
    { key: 'password',      icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>, label: 'Change Password' },
    { key: 'notifications', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>, label: 'Notifications' },
    { key: 'privacy',       icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>, label: 'Privacy & Data' },
  ]

  return (
    <aside className={styles.sidebar} aria-label="Account navigation">
      <div className={styles.sbProfile}>
        <div className={styles.sbAvatarRing}>
          <div className={styles.sbAvatar}>{initials}</div>
        </div>
        <div className={styles.sbName}>{fullName}</div>
        {email  && <div className={styles.sbSub}>{email}</div>}
        {!email && phone && <div className={styles.sbSub}>+91 {phone}</div>}
        {since  && <div className={styles.sbMember}>Member since {since}</div>}
      </div>

      {/* ── Stats row ─────────────────────────────────────────── */}
      {stats && (
        <>
          <div className={styles.sbStats}>
            <div className={styles.sbStat}>
              <div className={styles.sbStatVal}>{stats.total}</div>
              <div className={styles.sbStatLbl}>Orders</div>
            </div>
            <div className={styles.sbStatDiv} />
            <div className={styles.sbStat}>
              <div className={styles.sbStatVal}>{stats.delivered}</div>
              <div className={styles.sbStatLbl}>Delivered</div>
            </div>
            <div className={styles.sbStatDiv} />
            <div className={styles.sbStat}>
              <div className={styles.sbStatVal}>{formatCurrency(stats.spent)}</div>
              <div className={styles.sbStatLbl}>Spent</div>
            </div>
          </div>


        </>
      )}

      <div className={styles.sbNav}>
        {NAV.map(it => (
          <button
            key={it.key}
            type="button"
            className={[
              styles.sbItem,
              tab === it.key ? styles.sbItemActive : '',
              it.key === 'privacy'  ? styles.sbPrivacy  : '',
              it.key === 'loyalty'  ? styles.sbLoyalty  : '',
            ].filter(Boolean).join(' ')}
            onClick={() => { setTab(it.key); if (it.key === 'orders') onOrdersClick() }}
            aria-current={tab === it.key ? 'page' : undefined}
          >
            <span className={styles.sbIcon}>{it.icon}</span>
            <span className={styles.sbLabel}>{it.label}</span>
            {it.badge ? (
              <span className={it.key === 'loyalty' ? styles.sbCoinsBadge : styles.sbBadge}>
                {it.key === 'loyalty' ? coinsLabel : it.badge}
              </span>
            ) : null}
          </button>
        ))}
        <div className={styles.sbDiv} />
        <Link href="/wishlist" className={`${styles.sbItem} ${styles.sbWishlist}`}>
          <span className={styles.sbIcon}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></span>
          <span className={styles.sbLabel}>Wishlist</span>
        </Link>
        <button type="button" className={`${styles.sbItem} ${styles.sbLogout}`} onClick={onLogout}>
          <span className={styles.sbIcon}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></span>
          <span className={styles.sbLabel}>Logout</span>
        </button>
      </div>
    </aside>
  )
}
