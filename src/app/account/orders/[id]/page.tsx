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
import { CANCEL_REASONS } from '@/lib/orderCancellation'
import { computeOrderInvoice, invoiceRows } from '@/lib/invoiceGst'
import styles from '../../styles/account.module.css'
import Icon from '@/components/ui/Icon'

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
//
// Sept 2026: 'payment_failed' added here too. It is a real order_status_enum
// value (migration 048) written by the Razorpay payment.failed webhook. It is
// absent from STATUS_INDEX above by design — a failed payment never entered
// the fulfilment pipeline — so without this entry the page rendered neither
// the stepper (currentStep === -1) nor the terminal-state card: an empty
// "Order Status" box with no explanation of what happened.
const CANCELLED_STATUSES = ['cancelled', 'returned', 'payment_failed']

/** AUDIT ACC-038: an unpaid COD order must never say "Total Paid" (same rule as /order-success, CF3). */
function totalLabel(o: { payment_status?: string | null; payment_method: string | null }): string {
  if (o.payment_status === 'paid') return 'Total Paid'
  return o.payment_method === 'cod' ? 'Total (pay on delivery)' : 'Order Total'
}

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
  payment_status?:  string | null
  total_amount:     number
  subtotal?:        number
  coupon_discount?: number
  shipping_charge?: number
  cod_surcharge?:   number
  tax?:             number
  cgst?:            number
  sgst?:            number
  igst?:            number
  round_off?:       number
  loyalty_points_redeemed?: number
  loyalty_point_value?:     number
  created_at:       string
  shipping_address?: Record<string, string>
  items:            Array<{ name: string; qty: number; price: number; emoji: string; image_url: string | null }>
  tracking_number?: string | null
  courier?:         string | null
  can_cancel?:         boolean
  cancel_via_support?: boolean
}

export default function OrderDetailPage() {
  const { id }   = useParams<{ id: string }>()
  const [order,   setOrder]   = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  // ── Self-service cancellation (ACC-050) ─────────────────────────────
  const [cancelOpen,   setCancelOpen]   = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelBusy,   setCancelBusy]   = useState(false)
  const [cancelErr,    setCancelErr]    = useState('')
  const [cancelledMsg, setCancelledMsg] = useState('')

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

  async function submitCancel() {
    if (!order || !cancelReason || cancelBusy) return
    setCancelBusy(true); setCancelErr('')
    try {
      const res  = await fetch(`/api/orders/${order.id}/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason }),
        signal: AbortSignal.timeout(40_000),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; code?: string }
      if (res.ok) {
        setOrder(o => o ? { ...o, order_status: 'cancelled', _displayStatus: 'cancelled', can_cancel: false, cancel_via_support: false } : o)
        setCancelledMsg('Your order has been cancelled. Nothing was charged, and any Pahadi Coins you used are back in your account.')
        setCancelOpen(false)
        return
      }
      // 409 / contact_support: keep the page, explain, and stop offering the button
      if (res.status === 409) setOrder(o => o ? { ...o, can_cancel: false, cancel_via_support: data.code === 'contact_support' } : o)
      setCancelErr(data.error || 'We could not cancel your order — please try again or message us on WhatsApp.')
    } catch {
      setCancelErr('That took too long. Please check My Orders before trying again — your order may already be cancelled.')
    } finally {
      setCancelBusy(false)
    }
  }

  if (loading) return (
    <div className={`${styles.odSkWrap} ${styles.odSkBlock}`}>
      <div className={styles.odSkTitle} />
      <div className={styles.odSkCard} />
      <div className={styles.odSkCardSm} />
    </div>
  )

  if (error) return (
    <div className={styles.odError}>
      <div className={styles.odErrorIcon}><Icon name="warning" /></div>
      <p className={styles.odErrorMsg}>{error}</p>
      <Link prefetch={false} href="/account" className={styles.odBackLink}>← Back to Account</Link>
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
          <Link prefetch={false} href="/account" className={styles.odBackLink}>← Back to Account</Link>
          <div className={styles.odOrderNum} role="heading" aria-level={1}>{order.order_number}</div>
          <div className={styles.odOrderDate}>Placed on {formatDate(order.created_at)}</div>
        </div>
        <div className={styles.odHeaderRight}>
          <div className={styles.odTotal}>{formatCurrency(order.total_amount)}</div>
          <div className={styles.odPayMethod}>
            {order.payment_method === 'cod' ? 'Cash on Delivery' : 'Online Payment'}
          </div>
        </div>
      </div>

      {/* ── Invoice (AUDIT ACC-038: only reachable from the list card before) ── */}
      {!CANCELLED_STATUSES.includes(order.order_status) && (
        <a
          href={`/api/orders/${order.id}/invoice`}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.odTrackChip}
          style={{ marginRight: 8 }}
        >
          <Icon name="package" /> Invoice
        </a>
      )}

      {/* ── Cancel (COD, before packing) ─────────────────────── */}
      {cancelledMsg && (
        <div role="status" className={styles.odCard} style={{ borderColor: '#2d6a4f', marginBottom: 12 }}>{cancelledMsg}</div>
      )}
      {order.can_cancel && (
        <button type="button" className={styles.odTrackChip} style={{ background: '#fff', color: '#b3261e', border: '1.5px solid #b3261e', marginRight: 8, cursor: 'pointer' }}
          onClick={() => { setCancelOpen(true); setCancelErr(''); setCancelReason('') }}>
          Cancel order
        </button>
      )}
      {order.cancel_via_support && !order.can_cancel && (
        <a className={styles.odTrackChip} style={{ background: '#fff', color: '#1a3a1e', border: '1.5px solid #1a3a1e', marginRight: 8 }}
          href={`https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(`Hi, I'd like to cancel order ${order.order_number}.`)}`}
          target="_blank" rel="noopener noreferrer">
          Need to cancel? Message us
        </a>
      )}
      {cancelOpen && (
        <div role="dialog" aria-modal="true" aria-labelledby="cancel-title"
          onKeyDown={e => { if (e.key === 'Escape' && !cancelBusy) setCancelOpen(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 420 }}>
            <h2 id="cancel-title" style={{ margin: '0 0 8px', fontSize: 20 }}>Cancel order {order.order_number}?</h2>
            <p style={{ margin: '0 0 14px', color: '#555', fontSize: 14, lineHeight: 1.5 }}>
              This is a Cash-on-Delivery order, so nothing has been charged. We&apos;ll release the items and return any Pahadi Coins you used. This can&apos;t be undone.
            </p>
            <label htmlFor="cancel-reason" style={{ display: 'block', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Why are you cancelling?</label>
            <select id="cancel-reason" autoFocus value={cancelReason} onChange={e => setCancelReason(e.target.value)} disabled={cancelBusy}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #ddd', fontSize: 15, marginBottom: 12 }}>
              <option value="">Select a reason…</option>
              {CANCEL_REASONS.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
            {cancelErr && <p role="alert" style={{ color: '#b3261e', fontSize: 14, fontWeight: 600, margin: '0 0 12px' }}>{cancelErr}</p>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setCancelOpen(false)} disabled={cancelBusy}
                style={{ padding: '10px 16px', borderRadius: 10, border: '1.5px solid #ccc', background: '#fff', cursor: 'pointer' }}>Keep order</button>
              <button type="button" onClick={submitCancel} disabled={!cancelReason || cancelBusy} aria-busy={cancelBusy}
                style={{ padding: '10px 16px', borderRadius: 10, border: 'none', background: '#b3261e', color: '#fff', fontWeight: 700, cursor: !cancelReason || cancelBusy ? 'not-allowed' : 'pointer', opacity: !cancelReason || cancelBusy ? .6 : 1 }}>
                {cancelBusy ? 'Cancelling…' : 'Yes, cancel order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tracking chip ───────────────────────────────────── */}
      {trackUrl && (
        <a
          href={trackUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.odTrackChip}
        >
          <Icon name="truck" /> Track Shipment · {order.tracking_number}
        </a>
      )}

      {/* ── Status tracker ─────────────────────────────────── */}
      <div className={styles.odCard}>
        <div className={styles.odCardTitle} role="heading" aria-level={2}>Order Status</div>
        {isCancelled ? (
          <div className={styles.odCancelledState}>
            <div className={styles.odCancelledIcon}>
              {order.order_status === 'cancelled'
                ? '❌'
                : order.order_status === 'payment_failed' ? '💳' : '↩️'}
            </div>
            <div className={styles.odCancelledLabel}>
              {order.order_status === 'payment_failed'
                // Wording deliberately does NOT claim "no amount was charged":
                // a Razorpay payment.failed can still involve a debit that the
                // bank reverses, which is exactly what Razorpay's own failure
                // email tells the customer. Promising them otherwise here would
                // contradict that email and generate support tickets.
                ? 'Payment failed — this order was not placed. If any amount was debited, your bank will reverse it within 5–7 working days.'
                : order.order_status.replace(/_/g, ' ')}
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
          <div className={styles.odCardTitle} role="heading" aria-level={2}>Return Status</div>
          <div className={styles.odCancelledState}>
            <div className={styles.odCancelledIcon}>
              {order._return.status === 'refunded' ? '💚'
                : order._return.status === 'replaced' ? '📦'
                : order._return.status === 'rejected' ? '❌' : '↩️'}
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
      {/* AUDIT S3-006 / S1-009: rows come from the ONE shared invoice computation
          (lib/invoiceGst computeOrderInvoice) so Subtotal − discounts + Shipping + COD
          always equals Total Paid — including the derived prepaid / loyalty discount
          and the subtotal round-off that the order row does not store as columns. */}
      {(() => {
        const inv = computeOrderInvoice({
          items:                   order.items.map(i => ({ name: i.name, qty: i.qty, price: i.price })),
          total_amount:            order.total_amount,
          subtotal:                order.subtotal,
          coupon_discount:         order.coupon_discount,
          shipping_charge:         order.shipping_charge,
          cod_surcharge:           order.cod_surcharge,
          tax:                     order.tax,
          cgst:                    order.cgst,
          sgst:                    order.sgst,
          igst:                    order.igst,
          round_off:               order.round_off,
          loyalty_points_redeemed: order.loyalty_points_redeemed,
          state:                   order.shipping_address?.state,
        }, { loyaltyPointValue: order.loyalty_point_value })
        const rows = invoiceRows(inv)
        return (
          <div className={styles.odCard}>
            <div className={styles.odCardTitle}>Price Details</div>
            <div className={styles.odPriceRows}>
              {rows.filter(r => r.kind !== 'total').map(r => (
                <div key={r.key} className={`${styles.odPriceRow}${r.kind === 'discount' ? ` ${styles.odPriceRowDiscount}` : ''}`}>
                  <span>{r.label}</span>
                  <span>
                    {r.kind === 'discount' ? `−${formatCurrency(-r.amount)}`
                      : r.key === 'shipping' && r.amount === 0 ? 'FREE'
                      : formatCurrency(r.amount)}
                  </span>
                </div>
              ))}
              {inv.shipping === 0 && order.shipping_charge != null && (
                <div className={styles.odPriceRow}><span>Shipping</span><span>FREE</span></div>
              )}
              <hr className={styles.odPriceDivider} />
              <div className={styles.odPriceTotal}>
                <span>{totalLabel(order)}</span>
                <span>{formatCurrency(inv.total)}</span>
              </div>
              {order.tax != null && (
                <div className={styles.odPriceTax}>
                  {inv.tax > 0 && inv.taxableValue != null && <>Taxable value {formatCurrency(inv.taxableValue)} · </>}
                  Incl. {formatCurrency(inv.tax)} GST
                  {inv.tax > 0 && (inv.supplyType === 'intra'
                    ? ` (CGST ${formatCurrency(inv.cgst)} + SGST ${formatCurrency(inv.sgst)})`
                    : ` (IGST ${formatCurrency(inv.igst)})`)}
                </div>
              )}
            </div>
          </div>
        )
      })()}

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
          <Icon name="chat" /> WhatsApp Support
        </a>
      </div>

    </div>
  )
}
