'use client'
import Link from 'next/link'
import { BADGE_CLASS, STATUS_LABEL, STRIPE_CLASS, SUPPORT_WHATSAPP_NUMBER } from '@/lib/account/constants'
import { formatCurrency, formatDate, getOrderStatusMessage, getPaymentLabel, getCourierTrackingUrl } from '@/lib/account/utils'
import { type Order } from '@/lib/services/orderService'
import styles from '../styles/account.module.css'

// CSS Module class map — converts old kebab-case strings to module classes
const BADGE: Record<string, string> = {
  'badge-confirmed':        styles.badgeConfirmed,
  'badge-processing':       styles.badgeConfirmed,
  'badge-packed':           styles.badgePacked,
  'badge-shipped':          styles.badgeShipped,
  'badge-delivered':        styles.badgeDelivered,
  'badge-pending':          styles.badgePending,
  'badge-cancelled':        styles.badgeCancelled,
  'badge-returned':         styles.badgeReturn,
  'badge-return_requested': styles.badgeReturn,
  'badge-return_approved':  styles.badgeReturn,
  'badge-return_received':  styles.badgeReturn,
  'badge-refunded':         styles.badgeReturn,
  'badge-refund_initiated': styles.badgeReturn,
  'badge-refund_completed': styles.badgeReturn,
  'badge-return_rejected':  styles.badgeReturn,
}

const STRIPE: Record<string, string> = {
  'oc-stripe-confirmed':       styles.ocStripeConfirmed,
  'oc-stripe-packed':          styles.ocStripePacked,
  'oc-stripe-shipped':         styles.ocStripeShipped,
  'oc-stripe-delivered':       styles.ocStripeDelivered,
  'oc-stripe-pending':         styles.ocStripePending,
  'oc-stripe-cancelled':       styles.ocStripeCancelled,
  'oc-stripe-processing':      styles.ocStripeProcessing,
  'oc-stripe-returned':        styles.ocStripeReturn,
  'oc-stripe-return_requested':styles.ocStripeReturn,
  'oc-stripe-return_approved': styles.ocStripeReturn,
  'oc-stripe-return_received': styles.ocStripeReturn,
  'oc-stripe-refunded':        styles.ocStripeReturn,
  'oc-stripe-refund_initiated':styles.ocStripeReturn,
  'oc-stripe-refund_completed':styles.ocStripeReturn,
  'oc-stripe-return_rejected': styles.ocStripeReturn,
}

interface Props {
  order:         Order
  canReturn:     (o: Order) => boolean
  onReturnClick: (orderNum: string) => void
}

export default function OrderCard({ order: o, canReturn, onReturnClick }: Props) {
  const ds       = o._displayStatus || o.order_status || 'pending'
  const badgeCls = BADGE[BADGE_CLASS[ds]]   || styles.badgePending
  const stripeCls= STRIPE[STRIPE_CLASS[ds]] || styles.ocStripePending
  const label    = STATUS_LABEL[ds] || ds
  const date     = o.created_at ? formatDate(o.created_at) : ''
  const items    = o.items || []
  const statusMsg= getOrderStatusMessage(o)
  const pay      = getPaymentLabel(o.payment_method)
  const trackUrl = o.tracking_number
    ? getCourierTrackingUrl(o.courier, o.tracking_number)
    : ''

  const TIMELINE    = ['confirmed', 'packed', 'shipped', 'delivered']
  const timelineIdx = TIMELINE.indexOf(ds)
  const showTimeline= timelineIdx >= 0

  return (
    <div className={styles.orderCard}>
      <div className={`${styles.ocStripe} ${stripeCls}`} />
      <div className={styles.ocInner}>

        {/* Header */}
        <div className={styles.ocHdr}>
          <div className={styles.ocHdrLeft}>
            <div className={styles.ocNum}>{o.order_number || '#' + String(o.id).slice(0, 8)}</div>
            <div className={styles.ocDate}>{date}</div>
          </div>
          <div className={styles.ocHdrRight}>
            <span className={`${styles.ocBadge} ${badgeCls}`}>{label}</span>
            <span className={styles.ocTotal}>{formatCurrency(o.total_amount || 0)}</span>
            {pay.label && (
              <span className={`${styles.ocPay} ${pay.type === 'cod' ? styles.ocPayCod : styles.ocPayOnline}`}>
                {pay.label}
              </span>
            )}
          </div>
        </div>

        {/* Timeline */}
        {showTimeline && (
          <div className={styles.ocTimeline}>
            {TIMELINE.map((step, i) => (
              <div
                key={step}
                className={[
                  styles.otlStep,
                  i <= timelineIdx ? styles.otlStepDone    : '',
                  i === timelineIdx ? styles.otlStepCurrent : '',
                ].filter(Boolean).join(' ')}
              >
                <div className={styles.otlDot} />
                {i < TIMELINE.length - 1 && <div className={styles.otlLine} />}
                <div className={styles.otlLbl}>{STATUS_LABEL[step]}</div>
              </div>
            ))}
          </div>
        )}

        {/* Items */}
        {items.length > 0 && (
          <div className={styles.ocItemsRow}>
            <div className={styles.ocImgs}>
              {items.slice(0, 4).map((it, i) => (
                <div key={i} className={styles.ocImgBox}>
                  {it.image_url
                    ? <img src={it.image_url} alt={it.name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: '22px' }}>{it.emoji || '🌿'}</span>}
                </div>
              ))}
              {items.length > 4 && <div className={styles.ocImgMore}>+{items.length - 4}</div>}
            </div>
            <div className={styles.ocItemsNames}>
              {items.slice(0, 3).map((i) => `${i.name || 'Product'} ×${i.qty || 1}`).join(' · ')}
              {items.length > 3 && ` & ${items.length - 3} more`}
            </div>
          </div>
        )}

        {/* Status message */}
        {statusMsg && <div className={styles.ocStatusMsg}>{statusMsg}</div>}

        {/* Track chip */}
        {trackUrl && (
          <a href={trackUrl} target="_blank" rel="noopener noreferrer" className={styles.trackChip}>
            🚚 Track · {o.tracking_number}
          </a>
        )}

        {/* Actions */}
        <div className={styles.ocActions}>
          <div className={styles.ocActionsLeft}>
            <Link href={`/account/orders/${o.id}`} className={`${styles.actionBtn} ${styles.actionView}`}>
              View Details
            </Link>
            <Link href={`/account/orders/${o.id}?print=1`} target="_blank" className={`${styles.actionBtn} ${styles.actionInvoice}`}>
              Invoice
            </Link>
            {canReturn(o) && (
              <button className={`${styles.actionBtn} ${styles.actionReturn}`} onClick={() => onReturnClick(o.order_number || o.id)}>
                Return
              </button>
            )}
          </div>
          <a
            href={`https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent('Hi, I need help with order ' + (o.order_number || '') + '.')}`}
            target="_blank" rel="noopener noreferrer"
            className={`${styles.actionBtn} ${styles.actionSupport}`}
          >
            💬 Support
          </a>
        </div>
      </div>
    </div>
  )
}
