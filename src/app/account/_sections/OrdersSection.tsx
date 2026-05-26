'use client'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import OrderCard      from '../_components/OrderCard'
import OrdersSkeleton from '../_components/OrdersSkeleton'
import ErrorBoundary  from '@/components/ui/ErrorBoundary'
import { formatCurrency } from '@/lib/account/utils'
import { RETURN_REASONS } from '@/lib/account/constants'
import type { useOrders } from '../hooks/useOrders'
import type { Order }     from '../hooks/useOrders'
import styles from '../styles/account.module.css'

type Orders = ReturnType<typeof useOrders>

interface Props {
  orders:    Orders
  showToast: (msg: string, type?: 'success' | 'error') => void
}

export default function OrdersSection({ orders, showToast }: Props) {
  const [returnModal, setReturnModal] = useState<{ orderId: string; orderNum: string } | null>(null)
  const [returnReason, setReturnReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Focus management for keyboard-accessible modal
  const firstRadioRef  = useRef<HTMLInputElement>(null)
  const triggerBtnRef  = useRef<HTMLButtonElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // Move focus into modal when it opens; restore to trigger when it closes
  useEffect(() => {
    if (returnModal) {
      firstRadioRef.current?.focus()
    }
  }, [returnModal])

  // ESC key closes the modal
  useEffect(() => {
    if (!returnModal) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeReturnModal()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [returnModal, submitting])

  function openReturnModal(orderNum: string, triggerBtn?: HTMLButtonElement | null) {
    // orderNum may be the actual order_number or the id — find the order to get both
    const order = orders.filtered.find(
      (o: Order) => o.order_number === orderNum || String(o.id) === String(orderNum)
    )
    if (!order) return
    triggerBtnRef.current = triggerBtn ?? null
    setReturnReason('')
    setReturnModal({ orderId: String(order.id), orderNum: order.order_number || orderNum })
  }

  function closeReturnModal() {
    if (submitting) return
    setReturnModal(null)
    setReturnReason('')
    // Restore focus to the button that opened the modal
    triggerBtnRef.current?.focus()
    triggerBtnRef.current = null
  }

  async function submitReturn() {
    if (!returnModal || !returnReason) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/orders/${returnModal.orderId}/return`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reason: returnReason }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Return request failed', 'error')
      } else {
        showToast(data.message || '✅ Return request submitted!')
        setReturnModal(null)
        setReturnReason('')
        orders.refresh()
      }
    } catch {
      showToast('Network error — please try again', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ErrorBoundary section="Orders" onRetry={orders.refresh}>
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
                  <label htmlFor="order-search" className="sr-only">Search orders</label>
                  <input
                    id="order-search"
                    aria-label="Search orders by order number or product"
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
                      onReturnClick={openReturnModal}
                    />
                  ))}

                  {/* Load More */}
                  {orders.hasMore && (
                    <div style={{ textAlign: 'center', marginTop: '16px' }}>
                      <button
                        className={styles.btnSecondary}
                        onClick={orders.loadMore}
                        disabled={orders.loadingMore}
                      >
                        {orders.loadingMore ? 'Loading…' : `Load More (${orders.totalCount - orders.filtered.length} remaining)`}
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Return Request Modal ── */}
      {returnModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="return-modal-title"
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px',
          }}
          onClick={e => { if (e.target === e.currentTarget) closeReturnModal() }}
        >
          <div style={{
            background: 'var(--color-background-primary, #fff)',
            borderRadius: '12px',
            padding: '24px',
            width: '100%',
            maxWidth: '420px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 id="return-modal-title" style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>
                Return Order {returnModal.orderNum}
              </h3>
              <button
                ref={closeButtonRef}
                onClick={closeReturnModal}
                disabled={submitting}
                style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: 'var(--color-text-secondary, #666)', lineHeight: 1 }}
                aria-label="Close return modal"
              >✕</button>
            </div>

            <p style={{ fontSize: '13px', color: 'var(--color-text-secondary, #666)', marginBottom: '16px', lineHeight: 1.5 }}>
              Please select the reason for your return. Our team will contact you within 24–48 hours to arrange a pickup.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              {RETURN_REASONS.map((reason, index) => (
                <label key={reason} style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 12px',
                  border: `1.5px solid ${returnReason === reason ? 'var(--color-primary, #4a7c59)' : 'var(--color-border-tertiary, #e0e0e0)'}`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  background: returnReason === reason ? 'var(--color-primary-light, #f0f7f2)' : 'transparent',
                  transition: 'border-color 0.15s, background 0.15s',
                }}>
                  <input
                    ref={index === 0 ? firstRadioRef : undefined}
                    type="radio"
                    name="return-reason"
                    value={reason}
                    checked={returnReason === reason}
                    onChange={() => setReturnReason(reason)}
                    style={{ accentColor: 'var(--color-primary, #4a7c59)' }}
                  />
                  {reason}
                </label>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={closeReturnModal}
                disabled={submitting}
                className={styles.btnSecondary}
                style={{ flex: 1 }}
              >
                Cancel
              </button>
              <button
                onClick={submitReturn}
                disabled={!returnReason || submitting}
                className={styles.btnPrimary}
                style={{ flex: 2, opacity: (!returnReason || submitting) ? 0.6 : 1 }}
              >
                {submitting ? 'Submitting…' : 'Submit Return Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ErrorBoundary>
  )
}
