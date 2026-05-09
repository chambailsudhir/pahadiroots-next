'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { useState, useEffect } from 'react'
import { useUserStore } from '@/store/userStore'
import { supabase } from '@/lib/supabase'
import { formatPrice, formatDate } from '@/lib/utils'
import type { Order } from '@/types'

const STATUS_COLOR: Record<string, string> = {
  created: 'bg-stone-100 text-stone-600', pending_payment: 'bg-yellow-50 text-yellow-700',
  paid: 'bg-blue-50 text-blue-700', confirmed: 'bg-blue-50 text-blue-700',
  packed: 'bg-purple-50 text-purple-700', shipped: 'bg-indigo-50 text-indigo-700',
  out_for_delivery: 'bg-orange-50 text-orange-700', delivered: 'bg-forest-50 text-forest-700',
  cancelled: 'bg-red-50 text-red-600', returned: 'bg-stone-100 text-stone-600',
  refunded: 'bg-stone-100 text-stone-600', return_requested: 'bg-amber-50 text-amber-700',
}

export default function OrdersPage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  const user = useUserStore(s => s.user)

  if (!mounted) return null

  const { data: orders, isLoading } = useSWR<Order[]>(
    user ? `all-orders-${user.phone}` : null,
    async () => {
      const { data } = await supabase
        .from('orders')
        .select('id, order_number, order_status, payment_method, total_amount, created_at')
        .eq('customer_phone', user!.phone)
        .order('created_at', { ascending: false })
      return (data as Order[]) || []
    }
  )

  return (
    <div>
      <h1 className="text-lg font-bold text-stone-900 mb-5">My Orders</h1>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}</div>
      ) : !orders?.length ? (
        <div className="text-center py-16 border border-dashed border-stone-200 rounded-2xl">
          <div className="text-4xl mb-3">📦</div>
          <p className="text-stone-400 text-sm mb-3">No orders yet</p>
          <Link href="/products" className="text-forest-700 text-sm font-semibold hover:underline">Browse Products →</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map(order => (
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
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[order.order_status] || ''}`}>
                  {order.order_status.replace(/_/g, ' ')}
                </span>
                <span className="text-sm font-bold text-stone-900">{formatPrice(order.total_amount)}</span>
                <svg className="w-4 h-4 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
