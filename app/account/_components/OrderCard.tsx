'use client'
import Link from 'next/link'
import { BADGE_CLASS, STATUS_LABEL, STRIPE_CLASS } from '@/lib/account/constants'
import { formatCurrency, formatDate, getOrderStatusMessage, getPaymentLabel } from '@/lib/account/utils'

interface Props {
  order: any
  canReturn: (o: any) => boolean
  onReturnClick: (orderNum: string) => void
}

export default function OrderCard({ order: o, canReturn, onReturnClick }: Props) {
  const ds      = o._displayStatus || o.order_status || 'pending'
  const badge   = BADGE_CLASS[ds]   || 'badge-pending'
  const stripe  = STRIPE_CLASS[ds]  || 'oc-stripe-pending'
  const label   = STATUS_LABEL[ds]  || ds
  const date    = o.created_at ? formatDate(o.created_at) : ''
  const items   = o.items || []
  const statusMsg = getOrderStatusMessage(o)
  const pay     = getPaymentLabel(o.payment_method)
  const trackUrl = o.tracking_number
    ? `https://www.google.com/search?q=${encodeURIComponent((o.courier || '') + ' tracking ' + o.tracking_number)}`
    : ''

  // ── Order timeline ────────────────────────────────────────────
  const TIMELINE = ['confirmed','packed','shipped','delivered']
  const timelineIdx = TIMELINE.indexOf(ds)
  const showTimeline = timelineIdx >= 0

  return (
    <div className="order-card">
      <div className={`oc-stripe ${stripe}`} />
      <div className="oc-inner">

        {/* Header */}
        <div className="oc-hdr">
          <div className="oc-hdr-left">
            <div className="oc-num">{o.order_number || '#' + String(o.id).slice(0, 8)}</div>
            <div className="oc-date">{date}</div>
          </div>
          <div className="oc-hdr-right">
            <span className={`oc-badge ${badge}`}>{label}</span>
            <span className="oc-total">{formatCurrency(o.total_amount || 0)}</span>
            {pay.label && <span className={`oc-pay ${pay.cls}`}>{pay.label}</span>}
          </div>
        </div>

        {/* Timeline for active orders */}
        {showTimeline && (
          <div className="oc-timeline">
            {TIMELINE.map((step, i) => (
              <div key={step} className={`otl-step ${i <= timelineIdx ? 'done' : ''} ${i === timelineIdx ? 'current' : ''}`}>
                <div className="otl-dot" />
                {i < TIMELINE.length - 1 && <div className="otl-line" />}
                <div className="otl-lbl">{STATUS_LABEL[step]}</div>
              </div>
            ))}
          </div>
        )}

        {/* Product images + names */}
        {items.length > 0 && (
          <div className="oc-items-row">
            <div className="oc-imgs">
              {items.slice(0, 4).map((it: any, i: number) => (
                <div key={i} className="oc-img-box">
                  {it.image_url
                    ? <img src={it.image_url} alt={it.name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: '22px' }}>{it.emoji || '🌿'}</span>}
                </div>
              ))}
              {items.length > 4 && <div className="oc-img-more">+{items.length - 4}</div>}
            </div>
            <div className="oc-items-names">
              {items.slice(0, 3).map((i: any) => `${i.name || 'Product'} ×${i.qty || 1}`).join(' · ')}
              {items.length > 3 && ` & ${items.length - 3} more`}
            </div>
          </div>
        )}

        {/* Status message */}
        {statusMsg && <div className="oc-status-msg">{statusMsg}</div>}

        {/* Track chip */}
        {trackUrl && (
          <a href={trackUrl} target="_blank" rel="noopener noreferrer" className="track-chip">
            🚚 Track · {o.tracking_number}
          </a>
        )}

        {/* Actions */}
        <div className="oc-actions">
          <div className="oc-actions-left">
            <Link href={`/account/orders/${o.id}`} className="action-btn action-view">
              View Details
            </Link>
            <Link href={`/account/orders/${o.id}?print=1`} target="_blank" className="action-btn action-invoice">
              Invoice
            </Link>
            {canReturn(o) && (
              <button className="action-btn action-return" onClick={() => onReturnClick(o.order_number || o.id)}>
                Return
              </button>
            )}
          </div>
          <a
            href={`https://wa.me/919899984895?text=${encodeURIComponent('Hi, I need help with order ' + (o.order_number || '') + '.')}`}
            target="_blank" rel="noopener noreferrer"
            className="action-btn action-support"
          >
            💬 Support
          </a>
        </div>
      </div>
    </div>
  )
}
