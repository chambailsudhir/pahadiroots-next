'use client'
import Link from 'next/link'
import { getInitials, formatCurrency } from '@/lib/account/utils'

type Tab = 'orders' | 'addresses' | 'profile' | 'password'

interface Props {
  tab: Tab
  setTab: (t: Tab) => void
  profile: any
  authUser: any
  stats: { total: number; delivered: number; active: number; spent: number } | null
  onLogout: () => void
  onOrdersClick: () => void
}

export default function Sidebar({ tab, setTab, profile, authUser, stats, onLogout, onOrdersClick }: Props) {
  const firstName = profile?.first_name || authUser?.user_metadata?.full_name?.split(' ')[0] || 'User'
  const fullName  = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || firstName
  const email     = authUser?.email || profile?.email || ''
  const phone     = (profile?.phone || authUser?.phone || '').replace(/^\+91/, '')
  const initials  = getInitials(firstName)
  const since     = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
    : null

  const NAV: { key: Tab; icon: string; label: string; badge?: number | null }[] = [
    { key: 'orders',   icon: '📦', label: 'My Orders',      badge: stats?.active || null },
    { key: 'addresses',icon: '📍', label: 'Addresses' },
    { key: 'profile',  icon: '👤', label: 'Profile' },
    { key: 'password', icon: '🔒', label: 'Change Password' },
  ]

  return (
    <aside className="sidebar">
      <div className="sb-profile">
        <div className="sb-avatar-ring">
          <div className="sb-avatar">{initials}</div>
        </div>
        <div className="sb-name">{fullName}</div>
        {email  && <div className="sb-sub">{email}</div>}
        {!email && phone && <div className="sb-sub">+91 {phone}</div>}
        {since  && <div className="sb-member">Member since {since}</div>}
      </div>

      {stats && (
        <div className="sb-stats">
          <div className="sb-stat">
            <div className="sb-stat-val">{stats.total}</div>
            <div className="sb-stat-lbl">Orders</div>
          </div>
          <div className="sb-stat-div" />
          <div className="sb-stat">
            <div className="sb-stat-val">{stats.delivered}</div>
            <div className="sb-stat-lbl">Delivered</div>
          </div>
          <div className="sb-stat-div" />
          <div className="sb-stat">
            <div className="sb-stat-val">{formatCurrency(stats.spent)}</div>
            <div className="sb-stat-lbl">Spent</div>
          </div>
        </div>
      )}

      <div className="sb-nav">
        {NAV.map(it => (
          <button
            key={it.key}
            className={`sb-item${tab === it.key ? ' active' : ''}`}
            onClick={() => { setTab(it.key); if (it.key === 'orders') onOrdersClick() }}
          >
            <span className="sb-icon">{it.icon}</span>
            <span className="sb-label">{it.label}</span>
            {it.badge ? <span className="sb-badge">{it.badge}</span> : null}
          </button>
        ))}
        <div className="sb-div" />
        <Link href="/wishlist" className="sb-item sb-wishlist">
          <span className="sb-icon">❤️</span>
          <span className="sb-label">Wishlist</span>
        </Link>
        <button className="sb-item sb-logout" onClick={onLogout}>
          <span className="sb-icon">🚪</span>
          <span className="sb-label">Logout</span>
        </button>
      </div>
    </aside>
  )
}
