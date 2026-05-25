'use client'
// ─────────────────────────────────────────────────────────────
// /account/orders/[id] — order detail page
// Uses /api/orders/[id] (cookie auth) — NOT direct Supabase
// Fixed: removed mounted anti-pattern, proper error state,
//        no customer_phone auth
// ─────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { formatCurrency, formatDate, getCourierTrackingUrl } from '@/lib/account/utils'
import { SUPPORT_WHATSAPP_NUMBER } from '@/lib/account/constants'

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
const CANCELLED_STATUSES = ['cancelled','returned','refunded','return_requested','return_approved','return_received','refund_initiated','refund_completed','return_rejected']

type OrderDetail = Record<string, unknown> & {
  id:               string
  order_number:     string
  order_status:     string
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
    <div className="space-y-4">
      <div className="h-8 bg-stone-100 animate-pulse rounded w-48" />
      <div className="h-48 bg-stone-100 animate-pulse rounded-2xl" />
      <div className="h-32 bg-stone-100 animate-pulse rounded-2xl" />
    </div>
  )

  if (error) return (
    <div className="text-center py-16">
      <div className="text-4xl mb-3">⚠️</div>
      <p className="text-stone-500 text-sm mb-4">{error}</p>
      <Link href="/account" className="text-green-700 text-sm font-semibold hover:underline">← Back to Account</Link>
    </div>
  )

  if (!order) return null

  const currentStep = STATUS_INDEX[order.order_status] ?? -1
  const isCancelled = CANCELLED_STATUSES.includes(order.order_status)
  const trackUrl    = order.tracking_number
    ? getCourierTrackingUrl(order.courier, order.tracking_number)
    : null

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/account" className="text-xs text-green-700 hover:underline mb-1 inline-block">
            ← Back to Account
          </Link>
          <h1 className="text-lg font-bold text-stone-900 font-mono">{order.order_number}</h1>
          <p className="text-xs text-stone-400">Placed on {formatDate(order.created_at)}</p>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-stone-900">{formatCurrency(order.total_amount)}</div>
          <div className="text-xs text-stone-400 capitalize mt-0.5">
            {order.payment_method === 'cod' ? 'Cash on Delivery' : 'Online Payment'}
          </div>
        </div>
      </div>

      {/* Tracking chip */}
      {trackUrl && (
        <a href={trackUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-green-900 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-green-800 transition-colors">
          🚚 Track Shipment · {order.tracking_number}
        </a>
      )}

      {/* Status tracker */}
      <div className="bg-white border border-stone-200 rounded-2xl p-5">
        <h2 className="text-sm font-bold text-stone-700 mb-5">Order Status</h2>
        {isCancelled ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-2">
              {order.order_status === 'cancelled' ? '❌' : '↩️'}
            </div>
            <div className="font-semibold text-stone-700 capitalize">
              {order.order_status.replace(/_/g, ' ')}
            </div>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-5 top-5 bottom-5 w-0.5 bg-stone-100" />
            {currentStep >= 0 && (
              <div className="absolute left-5 top-5 w-0.5 bg-green-500 transition-all duration-700"
                style={{ height: `${(currentStep / (STATUS_STEPS.length - 1)) * 100}%` }} />
            )}
            <div className="space-y-4">
              {STATUS_STEPS.map((step, i) => {
                const done   = i <= currentStep
                const active = i === currentStep
                return (
                  <div key={step.status} className="flex items-center gap-4 relative">
                    <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center text-base border-2 transition-all ${
                      done ? 'border-green-500 bg-green-50' : 'border-stone-200 bg-white'
                    } ${active ? 'ring-2 ring-green-200 ring-offset-1' : ''}`}>
                      {step.icon}
                    </div>
                    <div>
                      <div className={`text-sm font-semibold ${done ? 'text-green-800' : 'text-stone-400'}`}>
                        {step.label}
                      </div>
                      {active && <div className="text-[11px] text-green-600">{step.desc}</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Items */}
      {order.items?.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-stone-700 mb-4">Items Ordered</h2>
          <div className="space-y-3">
            {order.items.map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg border border-stone-100 bg-stone-50 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {item.image_url
                    ? <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                    : <span className="text-xl">{item.emoji || '🌿'}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-stone-800 truncate">{item.name}</div>
                  <div className="text-xs text-stone-400">Qty: {item.qty}</div>
                </div>
                <div className="text-sm font-bold text-stone-900">{formatCurrency(item.price * item.qty)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delivery address */}
      {order.shipping_address && (
        <div className="bg-white border border-stone-200 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-stone-700 mb-3">Delivery Address</h2>
          <div className="text-sm text-stone-600 space-y-0.5">
            {order.shipping_address.name && <div className="font-semibold">{order.shipping_address.name}</div>}
            <div>{[order.shipping_address.flat, order.shipping_address.area].filter(Boolean).join(', ')}</div>
            <div>{order.shipping_address.city}, {order.shipping_address.state} — {order.shipping_address.pincode}</div>
            {order.shipping_address.phone && <div className="text-stone-400">{order.shipping_address.phone}</div>}
          </div>
        </div>
      )}

      {/* Price summary */}
      <div className="bg-white border border-stone-200 rounded-2xl p-5">
        <h2 className="text-sm font-bold text-stone-700 mb-4">Price Details</h2>
        <div className="space-y-2 text-sm">
          {order.subtotal != null && (
            <div className="flex justify-between text-stone-600"><span>Subtotal</span><span>{formatCurrency(order.subtotal)}</span></div>
          )}
          {(order.coupon_discount || 0) > 0 && (
            <div className="flex justify-between text-green-700"><span>Discount</span><span>−{formatCurrency(order.coupon_discount!)}</span></div>
          )}
          {order.shipping_charge != null && (
            <div className="flex justify-between text-stone-600"><span>Shipping</span><span>{order.shipping_charge === 0 ? 'FREE' : formatCurrency(order.shipping_charge)}</span></div>
          )}
          <div className="flex justify-between font-bold text-stone-900 pt-2 border-t border-stone-100">
            <span>Total Paid</span><span>{formatCurrency(order.total_amount)}</span>
          </div>
          {order.tax != null && <div className="text-[11px] text-stone-400">Incl. ₹{order.tax} GST</div>}
        </div>
      </div>

      {/* Support */}
      <div className="bg-stone-50 border border-stone-200 rounded-2xl p-5">
        <h2 className="text-sm font-bold text-stone-700 mb-3">Need Help?</h2>
        <a href={`https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent('Hi, I need help with order ' + order.order_number)}`}
          target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-green-300 text-green-700 text-sm font-semibold hover:bg-green-50 transition-colors">
          💬 WhatsApp Support
        </a>
      </div>
    </div>
  )
}
