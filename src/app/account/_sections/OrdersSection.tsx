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
  const [returnReason,    setReturnReason]    = useState('')
  const [returnOtherText, setReturnOtherText] = useState('')
  const [submitting,      setSubmitting]      = useState(false)

  // Focus management for keyboard-accessible modal
  const firstRadioRef  = useRef<HTMLInputElement>(null)
  const triggerBtnRef  = useRef<HTMLButtonElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const modalBoxRef    = useRef<HTMLDivElement>(null)

  // Move focus into modal when it opens; restore to trigger when it closes
  useEffect(() => {
    if (returnModal) {
      firstRadioRef.current?.focus()
    }
  }, [returnModal])

  // ESC key closes the modal; Tab/Shift+Tab are trapped inside
  useEffect(() => {
    if (!returnModal) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { closeReturnModal(); return }
      if (e.key !== 'Tab') return

      const modal = modalBoxRef.current
      if (!modal) return

      const focusable = Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => !el.closest('[disabled]'))

      if (focusable.length === 0) { e.preventDefault(); return }
      const first = focusable[0]
      const last  = focusable[focusable.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus() }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus() }
      }
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
    setReturnOtherText('')
    setReturnModal({ orderId: String(order.id), orderNum: order.order_number || orderNum })
  }

  function closeReturnModal() {
    if (submitting) return
    setReturnModal(null)
    setReturnReason('')
    setReturnOtherText('')
    // Restore focus to the button that opened the modal
    triggerBtnRef.current?.focus()
    triggerBtnRef.current = null
  }

  async function submitReturn() {
    if (!returnModal || !returnReason) return
    // If "Other" is selected, require the free-text explanation
    if (returnReason === 'Other' && !returnOtherText.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/orders/${returnModal.orderId}/return`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          reason:       returnReason,
          other_detail: returnReason === 'Other' ? returnOtherText.trim() : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Return request failed', 'error')
      } else {
        showToast(data.message || '✅ Return request submitted!')
        setReturnModal(null)
        setReturnReason('')
        setReturnOtherText('')
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
          className={styles.modalOverlay}
          onClick={e => { if (e.target === e.currentTarget) closeReturnModal() }}
        >
          <div ref={modalBoxRef} className={styles.modalBox}>
            <div className={styles.modalHeader}>
              <h3 id="return-modal-title" className={styles.modalTitle}>
                Return Order {returnModal.orderNum}
              </h3>
              <button
                ref={closeButtonRef}
                onClick={closeReturnModal}
                disabled={submitting}
                className={styles.modalCloseBtn}
                aria-label="Close return modal"
              >✕</button>
            </div>

            <p className={styles.modalDesc}>
              Please select the reason for your return. Our team will contact you within 24–48 hours to arrange a pickup.
            </p>

            <div className={styles.modalReasons}>
              {RETURN_REASONS.map((reason, index) => (
                <label key={reason} className={styles.modalReason}>
                  <input
                    ref={index === 0 ? firstRadioRef : undefined}
                    type="radio"
                    name="return-reason"
                    value={reason}
                    checked={returnReason === reason}
                    onChange={() => setReturnReason(reason)}
                    className={styles.modalReasonRadio}
                  />
                  {reason}
                </label>
              ))}
            </div>

            {/* Free-text explanation — required when "Other" is selected */}
            {returnReason === 'Other' && (
              <div className={styles.returnOtherWrap}>
                <label htmlFor="return-other-text" className={styles.fLbl}>
                  Please describe your reason *
                </label>
                <textarea
                  id="return-other-text"
                  className={styles.returnOtherTextarea}
                  value={returnOtherText}
                  onChange={e => setReturnOtherText(e.target.value)}
                  placeholder="Briefly describe why you'd like to return this item…"
                  maxLength={500}
                  rows={3}
                  autoFocus
                />
                <div className={styles.returnOtherCount}>
                  {returnOtherText.length}/500
                </div>
              </div>
            )}

            <div className={styles.modalFooter}>
              <button
                onClick={closeReturnModal}
                disabled={submitting}
                className={styles.btnSecondary}
              >
                Cancel
              </button>
              <button
                onClick={submitReturn}
                disabled={
                  !returnReason ||
                  (returnReason === 'Other' && !returnOtherText.trim()) ||
                  submitting
                }
                className={styles.btnPrimary}
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
