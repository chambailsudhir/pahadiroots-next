'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { useUserStore } from '@/store/userStore'
import { supabase } from '@/lib/supabase'
import { formatPrice, formatDate } from '@/lib/utils'
import type { Order, OrderStatus } from '@/types'

const STATUS_COLOR: Record<string, string> = {
  created:          'bg-stone-100 text-stone-600',
  pending_payment:  'bg-yellow-50 text-yellow-700',
  paid:             'bg-blue-50 text-blue-700',
  confirmed:        'bg-blue-50 text-blue-700',
  packed:           'bg-purple-50 text-purple-700',
  shipped:          'bg-indigo-50 text-indigo-700',
  out_for_delivery: 'bg-orange-50 text-orange-700',
  delivered:        'bg-forest-50 text-forest-700',
  cancelled:        'bg-red-50 text-red-600',
  returned:         'bg-stone-100 text-stone-600',
  refunded:         'bg-stone-100 text-stone-600',
  return_requested: 'bg-amber-50 text-amber-700',
}

export default function AccountPage() {
  const user = useUserStore(s => s.user)

  const { data: orders, isLoading } = useSWR<Order[]>(
    user ? `orders-${user.phone}` : null,
    async () => {
      const { data } = await supabase
        .from('orders')
        .select('id, order_number, order_status, payment_method, total_amount, created_at')
        .eq('customer_phone', user!.phone)
        .order('created_at', { ascending: false })
        .limit(10)
      return (data as Order[]) || []
    }
  )

  const recentOrders = orders?.slice(0, 3) || []

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="bg-forest-50 border border-forest-100 rounded-2xl p-5">
        <h1 className="text-lg font-bold text-forest-900 mb-1">
          Welcome back{user?.name ? `, ${user.name}` : ''}! 🌿
        </h1>
        <p className="text-sm text-forest-700">
          Manage your orders, addresses and wishlist from here.
        </p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Total Orders', value: orders?.length ?? '—', icon: '📦' },
          { label: 'Delivered',    value: orders?.filter(o => o.order_status === 'delivered').length ?? '—', icon: '✅' },
          { label: 'In Transit',   value: orders?.filter(o => ['shipped', 'out_for_delivery'].includes(o.order_status)).length ?? '—', icon: '🚛' },
        ].map(stat => (
          <div key={stat.label} className="bg-white border border-stone-100 rounded-xl p-4">
            <div className="text-xl mb-1">{stat.icon}</div>
            <div className="text-2xl font-bold text-stone-900">{stat.value}</div>
            <div className="text-xs text-stone-400 mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Recent orders */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-stone-900">Recent Orders</h2>
          <Link href="/account/orders" className="text-xs font-semibold text-forest-700 hover:underline">
            View all →
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}
          </div>
        ) : recentOrders.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-stone-200 rounded-2xl">
            <div className="text-3xl mb-2">🛒</div>
            <p className="text-stone-400 text-sm">No orders yet</p>
            <Link href="/products" className="mt-3 inline-block text-forest-700 text-sm font-semibold hover:underline">
              Start Shopping →
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {recentOrders.map(order => (
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
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
