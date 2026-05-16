'use client'
// ─────────────────────────────────────────────────────────────
// /account/orders — standalone orders list page
// Uses /api/orders (cookie auth) — NOT direct Supabase client
// ─────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fetchOrders, type Order } from '@/lib/services/orderService'
import { formatCurrency, formatDate } from '@/lib/account/utils'
import { STATUS_LABEL, BADGE_CLASS } from '@/lib/account/constants'

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
    <div className="space-y-2">
      {[1,2,3].map(i => <div key={i} className="h-16 bg-stone-100 animate-pulse rounded-xl" />)}
    </div>
  )

  if (error) return (
    <div className="text-center py-16 text-red-500 text-sm">{error}</div>
  )

  if (!orders?.length) return (
    <div className="text-center py-16 border border-dashed border-stone-200 rounded-2xl">
      <div className="text-4xl mb-3">📦</div>
      <p className="text-stone-400 text-sm mb-3">No orders yet</p>
      <Link href="/products" className="text-green-700 text-sm font-semibold hover:underline">Browse Products →</Link>
    </div>
  )

  return (
    <div>
      <h1 className="text-lg font-bold text-stone-900 mb-5">My Orders</h1>
      <div className="space-y-2">
        {orders.map(order => {
          const ds    = order._displayStatus || order.order_status || ''
          const badge = BADGE_CLASS[ds] || 'badge-pending'
          return (
            <Link
              key={order.id}
              href={`/account/orders/${order.id}`}
              className="flex items-center justify-between p-4 bg-white border border-stone-100 rounded-xl hover:border-stone-200 hover:shadow-sm transition-all"
            >
              <div>
                <div className="text-sm font-bold text-stone-800 font-mono">{order.order_number}</div>
                <div className="text-xs text-stone-400 mt-0.5">{formatDate(order.created_at)}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full oc-badge ${badge}`}>
                  {STATUS_LABEL[ds] || ds}
                </span>
                <span className="text-sm font-bold text-stone-900">{formatCurrency(order.total_amount)}</span>
                <svg className="w-4 h-4 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
