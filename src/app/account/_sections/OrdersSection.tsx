'use client'
import Link from 'next/link'
import OrderCard      from '../_components/OrderCard'
import OrdersSkeleton from '../_components/OrdersSkeleton'
import ErrorBoundary  from '@/components/ui/ErrorBoundary'
import { formatCurrency } from '@/lib/account/utils'
import type { useOrders } from '../hooks/useOrders'
import type { Order }     from '../hooks/useOrders'
import styles from '../styles/account.module.css'

type Orders = ReturnType<typeof useOrders>

interface Props {
  orders:    Orders
  showToast: (msg: string, type?: 'success' | 'error') => void
}

export default function OrdersSection({ orders, showToast }: Props) {
  return (
    <ErrorBoundary section="Orders">
      <div className={styles.panelSection}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle}>My Orders</div>
          {orders.stats && (
            <div className={styles.panelCount}>{orders.totalCount} orders</div>
          )}
        </div>

        {/* Summary strip */}
        {orders.stats && orders.stats.total > 0 && (
          <div className={styles.orderSummaryStrip}>
            {[
              { n: orders.stats.delivered, l: 'Delivered',   cls: styles.ossDelivered },
              { n: orders.stats.active,    l: 'In Transit',  cls: styles.ossActive    },
              { n: orders.stats.cancelled, l: 'Cancelled',   cls: styles.ossCancelled },
              { n: orders.stats.spent,     l: 'Total Spent', cls: styles.ossSpent, fmt: true },
            ].map(({ n, l, cls, fmt }) => (
              <div key={l} className={`${styles.ossItem} ${cls}`}>
                <span className={styles.ossNum}>{fmt ? formatCurrency(n) : n}</span>
                <span className={styles.ossLbl}>{l}</span>
              </div>
            ))}
          </div>
        )}

        <div className={styles.card}>
          {(orders.loading && orders.orders === null) ? <OrdersSkeleton /> : (
            <>
              {/* Toolbar */}
              <div className={styles.ordersToolbar}>
                <div className={styles.searchWrap}>
                  <span className={styles.searchIcon}>🔍</span>
                  <input
                    className={styles.ordersSearch}
                    type="text"
                    placeholder="Search by order # or product…"
                    value={orders.search}
                    onChange={e => orders.setSearch(e.target.value)}
                  />
                  {orders.search && (
                    <button type="button" className={styles.searchClear} onClick={() => orders.setSearch('')}>✕</button>
                  )}
                </div>
                <div className={styles.filterRow}>
                  {([
                    { key: 'all'       as const, label: 'All'       },
                    { key: 'active'    as const, label: 'Active'    },
                    { key: 'delivered' as const, label: 'Delivered' },
                    { key: 'returns'   as const, label: 'Returns'   },
                    { key: 'cancelled' as const, label: 'Cancelled' },
                  ]).map(f => (
                    <button
                      key={f.key}
                      className={`${styles.filterBtn}${orders.filter === f.key ? ' ' + styles.filterBtnActive : ''}`}
                      onClick={() => orders.setFilter(f.key)}
                    >{f.label}</button>
                  ))}
                </div>
              </div>

              {/* Order list */}
              {orders.filtered.length === 0 ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyIcon}>{!orders.orders?.length ? '🛍️' : '🔍'}</div>
                  <div className={styles.emptyTitle}>{!orders.orders?.length ? 'No orders yet' : 'Nothing found'}</div>
                  <p className={styles.emptySub}>
                    {!orders.orders?.length
                      ? 'Discover our Himalayan natural products.'
                      : 'Try adjusting your search or filter.'}
                  </p>
                  {!orders.orders?.length && <Link href="/products" className={styles.btnPrimary}>Shop Now →</Link>}
                  {!!orders.orders?.length && (
                    <button className={styles.btnSecondary} onClick={() => { orders.setFilter('all'); orders.setSearch('') }}>
                      Clear Filters
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {orders.filtered.map((o: Order) => (
                    <OrderCard
                      key={o.id}
                      order={o}
                      canReturn={orders.canReturn}
                      onReturnClick={(num: string) =>
                        showToast(`To return order ${num}, please contact support.`)
                      }
                    />
                  ))}

                  {/* Load More */}
                  {orders.hasMore && (
                    <div style={{ textAlign: 'center', marginTop: '16px' }}>
                      <button
                        className={styles.btnSecondary}
                        onClick={orders.loadMore}
                        disabled={orders.loading}
                      >
                        {orders.loading ? 'Loading…' : `Load More (${orders.totalCount - orders.filtered.length} remaining)`}
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </ErrorBoundary>
  )
}
