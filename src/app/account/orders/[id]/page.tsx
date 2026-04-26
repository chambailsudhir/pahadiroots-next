'use client'

import { useParams, useRouter } from 'next/navigation'
import useSWR from 'swr'
import Link from 'next/link'
import { useUserStore } from '@/store/userStore'
import { supabase } from '@/lib/supabase'
import { formatPrice, formatDate } from '@/lib/utils'
import type { Order, OrderStatus } from '@/types'

const STATUS_STEPS: { status: OrderStatus; label: string; desc: string; icon: string }[] = [
  { status: 'confirmed',        icon: '✅', label: 'Order Confirmed',    desc: 'Your order has been confirmed' },
  { status: 'packed',           icon: '📦', label: 'Packed',             desc: 'Your order is being packed' },
  { status: 'shipped',          icon: '🚛', label: 'Shipped',            desc: 'Your order is on the way' },
  { status: 'out_for_delivery', icon: '🏍️', label: 'Out for Delivery',  desc: 'Arriving today' },
  { status: 'delivered',        icon: '🎉', label: 'Delivered',          desc: 'Order delivered successfully' },
]

const STATUS_INDEX: Partial<Record<OrderStatus, number>> = {
  confirmed: 0, packed: 1, shipped: 2, out_for_delivery: 3, delivered: 4,
}

export default function OrderDetailPage() {
  const { id }   = useParams<{ id: string }>()
  const user     = useUserStore(s => s.user)
  const router   = useRouter()

  const { data: order, isLoading } = useSWR<Order | null>(
    user && id ? `order-${id}` : null,
    async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, order_number, order_status, payment_method, payment_status,
          total_amount, subtotal, coupon_discount, shipping_charge, tax,
          coupon_code, created_at, updated_at,
          shipping_address,
          order_items(id, product_id, variant_id, quantity, price_at_time)
        `)
        .eq('id', id)
        .eq('customer_phone', user!.phone)
        .single()
      if (error) { router.replace('/account/orders'); return null }
      return data as Order | null
    }
  )

  if (isLoading) return (
    <div className="space-y-4">
      <div className="h-8 skeleton rounded w-48" />
      <div className="h-48 skeleton rounded-2xl" />
      <div className="h-32 skeleton rounded-2xl" />
    </div>
  )

  if (!order) return null

  const currentStep = STATUS_INDEX[order.order_status] ?? -1
  const isCancelled = ['cancelled', 'returned', 'refunded', 'return_requested'].includes(order.order_status)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/account/orders" className="text-xs text-forest-700 hover:underline mb-1 inline-block">
            ← Back to orders
          </Link>
          <h1 className="text-lg font-bold text-stone-900 font-mono">{order.order_number}</h1>
          <p className="text-xs text-stone-400">Placed on {formatDate(order.created_at)}</p>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-stone-900">{formatPrice(order.total_amount)}</div>
          <div className="text-xs text-stone-400 capitalize mt-0.5">
            {order.payment_method === 'cod' ? 'Cash on Delivery' : 'Online Payment'}
          </div>
        </div>
      </div>

      {/* Status tracker */}
      <div className="bg-white border border-stone-200 rounded-2xl p-5">
        <h2 className="text-sm font-bold text-stone-700 mb-5">Order Status</h2>

        {isCancelled ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-2">
              {order.order_status === 'cancelled' ? '❌' : order.order_status === 'return_requested' ? '↩️ Return Requested' : '✅ Returned'}
            </div>
            <div className="font-semibold text-stone-700 capitalize">{order.order_status.replace(/_/g, ' ')}</div>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-5 top-5 bottom-5 w-0.5 bg-stone-100" />
            {currentStep >= 0 && (
              <div
                className="absolute left-5 top-5 w-0.5 bg-forest-500 transition-all duration-700"
                style={{ height: `${(currentStep / (STATUS_STEPS.length - 1)) * 100}%` }}
              />
            )}
            <div className="space-y-4">
              {STATUS_STEPS.map((step, i) => {
                const done   = i <= currentStep
                const active = i === currentStep
                return (
                  <div key={step.status} className="flex items-center gap-4 relative">
                    <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center text-base border-2 transition-all ${
                      done ? 'border-forest-500 bg-forest-50' : 'border-stone-200 bg-white'
                    } ${active ? 'ring-2 ring-forest-200 ring-offset-1' : ''}`}>
                      {step.icon}
                    </div>
                    <div>
                      <div className={`text-sm font-semibold ${done ? 'text-forest-800' : 'text-stone-400'}`}>
                        {step.label}
                      </div>
                      {active && <div className="text-[11px] text-forest-600">{step.desc}</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Delivery address */}
      {order.shipping_address && (
        <div className="bg-white border border-stone-200 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-stone-700 mb-3">Delivery Address</h2>
          <div className="text-sm text-stone-600 space-y-0.5">
            <div className="font-semibold">{order.shipping_address.name}</div>
            <div>{order.shipping_address.flat}{order.shipping_address.area ? `, ${order.shipping_address.area}` : ''}</div>
            <div>{order.shipping_address.city}, {order.shipping_address.state} — {order.shipping_address.pincode}</div>
            <div className="text-stone-400">{order.shipping_address.phone}</div>
          </div>
        </div>
      )}

      {/* Price summary */}
      <div className="bg-white border border-stone-200 rounded-2xl p-5">
        <h2 className="text-sm font-bold text-stone-700 mb-4">Price Details</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between text-stone-600"><span>Subtotal</span><span>{formatPrice(order.subtotal)}</span></div>
          {(order.coupon_discount || 0) > 0 && <div className="flex justify-between text-forest-700"><span>Discount</span><span>−{formatPrice(order.coupon_discount)}</span></div>}
          <div className="flex justify-between text-stone-600"><span>Shipping</span><span>{order.shipping_charge === 0 ? 'FREE' : formatPrice(order.shipping_charge)}</span></div>
          <div className="flex justify-between font-bold text-stone-900 pt-2 border-t border-stone-100">
            <span>Total Paid</span><span>{formatPrice(order.total_amount)}</span>
          </div>
          <div className="text-[11px] text-stone-400">Incl. ₹{order.tax} GST</div>
        </div>
      </div>

      {/* Actions */}
      {order.order_status === 'delivered' && (
        <div className="bg-stone-50 border border-stone-200 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-stone-700 mb-3">Need Help?</h2>
          <div className="flex gap-3">
            <a
              href={`https://wa.me/?text=Hi, I need help with order ${order.order_number}`}
              target="_blank" rel="noopener noreferrer"
              className="flex-1 text-center py-2.5 rounded-xl border border-green-300 text-green-700 text-sm font-semibold hover:bg-green-50 transition-colors"
            >
              WhatsApp Support
            </a>
            <button className="flex-1 py-2.5 rounded-xl border border-stone-200 text-stone-600 text-sm font-semibold hover:bg-stone-100 transition-colors">
              Request Return
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
