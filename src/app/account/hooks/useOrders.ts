// ─────────────────────────────────────────────────────────────
// useOrders — fetch + filter + search orders
// ─────────────────────────────────────────────────────────────
'use client'

import { useState, useMemo } from 'react'
import { accountApi, storage } from '@/lib/account/api'
import { ACTIVE_STATUSES, RETURN_STATUSES } from '@/lib/account/constants'

export function useOrders(token: string | null, setToken: (t: string) => void) {
  const [orders,  setOrders]  = useState<any[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter,  setFilter]  = useState('all')
  const [search,  setSearch]  = useState('')

  async function fetchOrders() {
    if (!token) return
    setLoading(true)
    try {
      const d = await accountApi.getOrders(token, (newTk) => setToken(newTk))
      setOrders(d.orders || [])
    } catch (e: any) {
      console.error('[useOrders] fetch failed:', e.message)
      setOrders([])
    } finally {
      setLoading(false)
    }
  }

  // Derived stats — memoized so they don't recalculate on every keystroke
  const stats = useMemo(() => {
    if (!orders) return null
    return {
      total:     orders.length,
      delivered: orders.filter(o => (o._displayStatus || o.order_status) === 'delivered').length,
      active:    orders.filter(o => ACTIVE_STATUSES.includes(o._displayStatus || o.order_status || '')).length,
      cancelled: orders.filter(o => (o._displayStatus || o.order_status) === 'cancelled').length,
      spent:     orders
        .filter(o => (o._displayStatus || o.order_status) !== 'cancelled')
        .reduce((s: number, o: any) => s + (o.total_amount || 0), 0),
    }
  }, [orders])

  // Filtered + searched orders — memoized
  const filtered = useMemo(() => {
    if (!orders) return []
    return orders.filter(o => {
      const s  = o._displayStatus || o.order_status || ''
      const mF = filter === 'all'
        || (filter === 'active'     && ACTIVE_STATUSES.includes(s))
        || (filter === 'delivered'  && s === 'delivered')
        || (filter === 'returns'    && RETURN_STATUSES.includes(s))
        || (filter === 'cancelled'  && s === 'cancelled')
      const q  = search.toLowerCase().trim()
      const mQ = !q
        || (o.order_number || '').toLowerCase().includes(q)
        || (o.items || []).some((i: any) => (i.name || '').toLowerCase().includes(q))
      return mF && mQ
    })
  }, [orders, filter, search])

  function canReturn(o: any) {
    if ((o._displayStatus || o.order_status) !== 'delivered') return false
    if (!o.delivered_at && !o.updated_at) return true
    const days = (Date.now() - new Date(o.delivered_at || o.updated_at).getTime()) / 86_400_000
    return days <= 7
  }

  return { orders, loading, filter, setFilter, search, setSearch, filtered, stats, fetchOrders, canReturn }
}
