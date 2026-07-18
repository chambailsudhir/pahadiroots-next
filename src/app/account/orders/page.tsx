'use client'
// ─────────────────────────────────────────────────────────────
// /account/orders — standalone orders list page
// Uses /api/orders (cookie auth) — NOT direct Supabase client
//  ✅ Migrated from Tailwind to account.module.css
//  ✅ Fixed oc-badge raw class string (was never matching anything);
//     badge styles now applied via CSS Modules (ocBadge + status variant)
// ─────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fetchOrders, type Order } from '@/lib/services/orderService'
import { formatCurrency, formatDate } from '@/lib/account/utils'
import { STATUS_LABEL } from '@/lib/account/constants'
import styles from '../styles/account.module.css'

// Map display status → CSS Module class for the badge.
// Reconciled to the real 5-value returns.status lifecycle — see
// lib/account/constants.ts BADGE_CLASS for the full explanation.
const BADGE_MODULE_CLASS: Record<string, string> = {
  pending:           styles.badgePending,
  confirmed:         styles.badgeConfirmed,
  packed:            styles.badgePacked,
  shipped:           styles.badgeShipped,
  delivered:         styles.badgeDelivered,
  cancelled:         styles.badgeCancelled,
  returned:          styles.badgeReturn,
  return_requested:  styles.badgeReturn,
  return_approved:   styles.badgeReturn,
  return_received:   styles.badgeReturn,
  return_refunded:   styles.badgeReturn,
  return_rejected:   styles.badgeCancelled,
}

export default function OrdersPage() {
  const [orders,  setOrders]  = useState<Order[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    const ctrl = new AbortController()
    fetchOrders({ limit: 50, signal: ctrl.signal })
      .then(res => { if (!ctrl.signal.aborted) setOrders(res.orders) })
      .catch(e  => { if (!ctrl.signal.aborted) setError(e?.message || 'Failed to load orders') })
      .finally(()=> { if (!ctrl.signal.aborted) setLoading(false) })
    return () => ctrl.abort()
  }, [])

  if (loading) return (
    <div className={styles.soLoading}>
      {[1, 2, 3].map(i => <div key={i} className={styles.soSkRow} />)}
    </div>
  )

  if (error?.includes('401') || error?.includes('Unauthorized') || error?.includes('Not logged in')) return (
    <div className={styles.soAuthWall}>
      <div className={styles.soAuthIcon}>🔒</div>
      <p className={styles.soAuthMsg}>Please sign in to view your orders</p>
      <a href="/account" className={styles.soAuthLink}>Sign In</a>
    </div>
  )

  if (error) return (
    <div className={styles.soError}>{error}</div>
  )

  if (!orders?.length) return (
    <div className={styles.soEmpty}>
      <div className={styles.soEmptyIcon}>📦</div>
      <p className={styles.soEmptyMsg}>No orders yet</p>
      <Link href="/products" className={styles.soEmptyLink}>Browse Products →</Link>
    </div>
  )

  return (
    <div className={styles.soRoot}>
      <h1 className={styles.soTitle}>My Orders</h1>
      <div className={styles.soList}>
        {orders.map(order => {
          const ds        = order._displayStatus || order.order_status || ''
          const badgeCls  = BADGE_MODULE_CLASS[ds] || styles.badgePending
          return (
            <Link
              key={order.id}
              href={`/account/orders/${order.id}`}
              className={styles.soRow}
            >
              <div className={styles.soRowLeft}>
                <div className={styles.soOrderNum}>{order.order_number}</div>
                <div className={styles.soOrderDate}>{formatDate(order.created_at)}</div>
              </div>
              <div className={styles.soRowRight}>
                <span className={`${styles.ocBadge} ${badgeCls}`}>
                  {STATUS_LABEL[ds] || ds}
                </span>
                <span className={styles.soTotal}>{formatCurrency(order.total_amount)}</span>
                <svg className={styles.soChevron} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
