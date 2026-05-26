'use client'
import Link from 'next/link'
import { getInitials, formatCurrency } from '@/lib/account/utils'
import { type Profile, type AuthUser } from '../hooks/useAuth'
import styles from '../styles/account.module.css'

export type Tab = 'orders' | 'addresses' | 'profile' | 'password' | 'notifications' | 'privacy'

interface Props {
  tab:           Tab
  setTab:        (t: Tab) => void
  profile:       Profile | null
  authUser:      AuthUser | null
  stats:         { total: number; delivered: number; active: number; spent: number } | null
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

  const NAV: { key: Tab; icon: string; label: string; badge?: number | null }[] = [
    { key: 'orders',        icon: '📦', label: 'My Orders',       badge: stats?.active || null },
    { key: 'addresses',     icon: '📍', label: 'Addresses' },
    { key: 'profile',       icon: '👤', label: 'Profile' },
    { key: 'password',      icon: '🔒', label: 'Change Password' },
    { key: 'notifications', icon: '🔔', label: 'Notifications' },
    { key: 'privacy',       icon: '🛡️', label: 'Privacy & Data' },
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

      {stats && (
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
      )}

      <div className={styles.sbNav}>
        {NAV.map(it => (
          <button
            key={it.key}
            className={[
              styles.sbItem,
              tab === it.key ? styles.sbItemActive : '',
              it.key === 'privacy' ? styles.sbPrivacy : '',
            ].filter(Boolean).join(' ')}
            onClick={() => { setTab(it.key); if (it.key === 'orders') onOrdersClick() }}
            aria-current={tab === it.key ? 'page' : undefined}
          >
            <span className={styles.sbIcon}>{it.icon}</span>
            <span className={styles.sbLabel}>{it.label}</span>
            {it.badge ? <span className={styles.sbBadge}>{it.badge}</span> : null}
          </button>
        ))}
        <div className={styles.sbDiv} />
        <Link href="/wishlist" className={`${styles.sbItem} ${styles.sbWishlist}`}>
          <span className={styles.sbIcon}>❤️</span>
          <span className={styles.sbLabel}>Wishlist</span>
        </Link>
        <button className={`${styles.sbItem} ${styles.sbLogout}`} onClick={onLogout}>
          <span className={styles.sbIcon}>🚪</span>
          <span className={styles.sbLabel}>Logout</span>
        </button>
      </div>
    </aside>
  )
}
