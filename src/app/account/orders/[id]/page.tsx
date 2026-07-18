'use client'
// ─────────────────────────────────────────────────────────────
// /account/orders/[id] — order detail page
// Uses /api/orders/[id] (cookie auth) — NOT direct Supabase
// Fixed: removed mounted anti-pattern, proper error state,
//        no customer_phone auth
// Style: migrated from Tailwind to account.module.css for
//        consistency with the rest of the account module.
// ─────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { formatCurrency, formatDate, getCourierTrackingUrl } from '@/lib/account/utils'
import { SUPPORT_WHATSAPP_NUMBER, STATUS_LABEL } from '@/lib/account/constants'
import styles from '../../styles/account.module.css'

const STATUS_STEPS = [
  { status: 'confirmed',        icon: '✅', label: 'Order Confirmed',   desc: 'Your order has been confirmed' },
  { status: 'packed',           icon: '📦', label: 'Packed',            desc: 'Your order is being packed' },
  { status: 'shipped',          icon: '🚛', label: 'Shipped',           desc: 'Your order is on the way' },
  { status: 'out_for_delivery', icon: '🏍️', label: 'Out for Delivery', desc: 'Arriving today' },
  { status: 'delivered',        icon: '🎉', label: 'Delivered',         desc: 'Order delivered successfully' },
]
const STATUS_INDEX: Record<string, number> = {
  confirmed: 0, packed: 1, shipped: 2, out_for_delivery: 3, delivered: 4,
}
// BUG FIX (architecture): order_status never actually becomes any of the
// return_* / refund_* values that used to be listed here — confirmed live,
// order_status_enum has only 7 values and returns live in a separate table
// (see PAHADI_ROOTS_SESSION_REPORT.md §2). Real "special state" order
// statuses are just 'cancelled' and 'returned'; a return in progress is
// now shown via the dedicated Return Status card below instead.
const CANCELLED_STATUSES = ['cancelled', 'returned']

type OrderDetail = Record<string, unknown> & {
  id:               string
  order_number:     string
  order_status:     string
  _displayStatus?:  string
  _return?: {
    status:         string
    reason:         string | null
    description:    string | null
    refund_amount:  number | null
    created_at:     string
    updated_at:     string | null
  } | null
  payment_method:   string | null
  total_amount:     number
  subtotal?:        number
  coupon_discount?: number
  shipping_charge?: number
  tax?:             number
  created_at:       string
  shipping_address?: Record<string, string>
  items:            Array<{ name: string; qty: number; price: number; emoji: string; image_url: string | null }>
  tracking_number?: string | null
  courier?:         string | null
}

export default function OrderDetailPage() {
  const { id }   = useParams<{ id: string }>()
  const [order,   setOrder]   = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    if (!id) return
    const ctrl = new AbortController()
    fetch(`/api/orders/${id}`, { signal: ctrl.signal })
      .then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`)
        return res.json()
      })
      .then(data => { if (!ctrl.signal.aborted) setOrder(data.order ?? data) })
      .catch(e  => { if (!ctrl.signal.aborted) setError(e?.message || 'Failed to load order') })
      .finally(()=> { if (!ctrl.signal.aborted) setLoading(false) })
    return () => ctrl.abort()
  }, [id])

  if (loading) return (
    <div className={`${styles.odSkWrap} ${styles.odSkBlock}`}>
      <div className={styles.odSkTitle} />
      <div className={styles.odSkCard} />
      <div className={styles.odSkCardSm} />
    </div>
  )

  if (error) return (
    <div className={styles.odError}>
      <div className={styles.odErrorIcon}>⚠️</div>
      <p className={styles.odErrorMsg}>{error}</p>
      <Link href="/account" className={styles.odBackLink}>← Back to Account</Link>
    </div>
  )

  if (!order) return null

  const currentStep = STATUS_INDEX[order.order_status] ?? -1
  const isCancelled = CANCELLED_STATUSES.includes(order.order_status)
  const trackUrl    = order.tracking_number
    ? getCourierTrackingUrl(order.courier, order.tracking_number)
    : null

  return (
    <div className={styles.odRoot}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div className={styles.odHeader}>
        <div>
          <Link href="/account" className={styles.odBackLink}>← Back to Account</Link>
          <div className={styles.odOrderNum}>{order.order_number}</div>
          <div className={styles.odOrderDate}>Placed on {formatDate(order.created_at)}</div>
        </div>
        <div className={styles.odHeaderRight}>
          <div className={styles.odTotal}>{formatCurrency(order.total_amount)}</div>
          <div className={styles.odPayMethod}>
            {order.payment_method === 'cod' ? 'Cash on Delivery' : 'Online Payment'}
          </div>
        </div>
      </div>

      {/* ── Tracking chip ───────────────────────────────────── */}
      {trackUrl && (
        <a
          href={trackUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.odTrackChip}
        >
          🚚 Track Shipment · {order.tracking_number}
        </a>
      )}

      {/* ── Status tracker ─────────────────────────────────── */}
      <div className={styles.odCard}>
        <div className={styles.odCardTitle}>Order Status</div>
        {isCancelled ? (
          <div className={styles.odCancelledState}>
            <div className={styles.odCancelledIcon}>
              {order.order_status === 'cancelled' ? '❌' : '↩️'}
            </div>
            <div className={styles.odCancelledLabel}>
              {order.order_status.replace(/_/g, ' ')}
            </div>
          </div>
        ) : (
          <div className={styles.odStepsWrap}>
            <div className={styles.odStepsTrack} />
            {currentStep >= 0 && (
              <div
                className={styles.odStepsFill}
                style={{ height: `${(currentStep / (STATUS_STEPS.length - 1)) * 100}%` }}
              />
            )}
            <div className={styles.odStepsList}>
              {STATUS_STEPS.map((step, i) => {
                const done   = i <= currentStep
                const active = i === currentStep
                return (
                  <div key={step.status} className={styles.odStep}>
                    <div
                      className={[
                        styles.odStepDot,
                        done   ? styles.odStepDotDone   : '',
                        active ? styles.odStepDotActive : '',
                      ].join(' ')}
                    >
                      {step.icon}
                    </div>
                    <div>
                      <div
                        className={[
                          styles.odStepLabel,
                          done   ? styles.odStepLabelDone   : '',
                          active ? styles.odStepLabelActive : '',
                        ].join(' ')}
                      >
                        {step.label}
                      </div>
                      {active && (
                        <div className={styles.odStepDesc}>{step.desc}</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Return status (only when a return exists for this order) ── */}
      {order._return && (
        <div className={styles.odCard}>
          <div className={styles.odCardTitle}>Return Status</div>
          <div className={styles.odCancelledState}>
            <div className={styles.odCancelledIcon}>
              {order._return.status === 'refunded' ? '💚' : order._return.status === 'rejected' ? '❌' : '↩️'}
            </div>
            <div className={styles.odCancelledLabel}>
              {STATUS_LABEL[`return_${order._return.status}`] || order._return.status}
            </div>
          </div>
          {order._return.reason && (
            <div className={styles.odAddrLines} style={{ marginTop: '8px' }}>
              <div>Reason: {order._return.reason}</div>
              {order._return.description && <div>{order._return.description}</div>}
            </div>
          )}
        </div>
      )}

      {/* ── Items ordered ───────────────────────────────────── */}
      {order.items?.length > 0 && (
        <div className={styles.odCard}>
          <div className={styles.odCardTitle}>Items Ordered</div>
          <div className={styles.odItemsList}>
            {order.items.map((item, i) => (
              <div key={i} className={styles.odItem}>
                <div className={styles.odItemImg}>
                  {item.image_url
                    ? <Image src={item.image_url} alt={item.name} width={64} height={64} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span className={styles.odItemEmoji}>{item.emoji || '🌿'}</span>}
                </div>
                <div className={styles.odItemInfo}>
                  <div className={styles.odItemName}>{item.name}</div>
                  <div className={styles.odItemQty}>Qty: {item.qty}</div>
                </div>
                <div className={styles.odItemPrice}>{formatCurrency(item.price * item.qty)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Delivery address ────────────────────────────────── */}
      {order.shipping_address && (
        <div className={styles.odCard}>
          <div className={styles.odCardTitle}>Delivery Address</div>
          <div className={styles.odAddrLines}>
            {order.shipping_address.name && (
              <div className={styles.odAddrName}>{order.shipping_address.name}</div>
            )}
            <div>
              {[order.shipping_address.flat, order.shipping_address.area]
                .filter(Boolean)
                .join(', ')}
            </div>
            <div>
              {order.shipping_address.city}, {order.shipping_address.state} —{' '}
              {order.shipping_address.pincode}
            </div>
            {order.shipping_address.phone && (
              <div className={styles.odAddrPhone}>{order.shipping_address.phone}</div>
            )}
          </div>
        </div>
      )}

      {/* ── Price summary ───────────────────────────────────── */}
      <div className={styles.odCard}>
        <div className={styles.odCardTitle}>Price Details</div>
        <div className={styles.odPriceRows}>
          {order.subtotal != null && (
            <div className={styles.odPriceRow}>
              <span>Subtotal</span>
              <span>{formatCurrency(order.subtotal)}</span>
            </div>
          )}
          {(order.coupon_discount || 0) > 0 && (
            <div className={`${styles.odPriceRow} ${styles.odPriceRowDiscount}`}>
              <span>Discount</span>
              <span>−{formatCurrency(order.coupon_discount!)}</span>
            </div>
          )}
          {order.shipping_charge != null && (
            <div className={styles.odPriceRow}>
              <span>Shipping</span>
              <span>{order.shipping_charge === 0 ? 'FREE' : formatCurrency(order.shipping_charge)}</span>
            </div>
          )}
          <hr className={styles.odPriceDivider} />
          <div className={styles.odPriceTotal}>
            <span>Total Paid</span>
            <span>{formatCurrency(order.total_amount)}</span>
          </div>
          {order.tax != null && (
            <div className={styles.odPriceTax}>Incl. ₹{order.tax} GST</div>
          )}
        </div>
      </div>

      {/* ── Support ─────────────────────────────────────────── */}
      <div className={styles.odSupportWrap}>
        <div className={styles.odCardTitle}>Need Help?</div>
        <a
          href={`https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(
            'Hi, I need help with order ' + order.order_number,
          )}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.actionBtn} ${styles.actionSupport}`}
        >
          💬 WhatsApp Support
        </a>
      </div>

    </div>
  )
}
