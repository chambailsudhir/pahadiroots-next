// ─────────────────────────────────────────────────────────────
// useOrders — fetch + filter + search orders
// ─────────────────────────────────────────────────────────────
'use client'

import { useState, useMemo, useRef } from 'react'
import { accountApi } from '@/lib/account/api'
import { ACTIVE_STATUSES, RETURN_STATUSES } from '@/lib/account/constants'

// Typed filter — prevents silent string mismatch bugs
export type OrderFilter = 'all' | 'active' | 'delivered' | 'returns' | 'cancelled'

// Order types
export interface OrderItem {
  qty:       number
  price:     number
  name:      string
  emoji:     string
  image_url: string | null
}

export interface Order {
  id:              string | number
  order_number:    string
  order_status:    string
  _displayStatus:  string
  payment_method:  string | null
  payment_status:  string | null
  total_amount:    number
  created_at:      string
  tracking_number: string | null
  courier:         string | null
  shipped_at:      string | null
  delivered_at:    string | null
  items:           OrderItem[]
  _return:         unknown | null
}

export function useOrders(token: string | null, setToken: (t: string) => void) {
  const [orders,       setOrders]     = useState<Order[] | null>(null)
  const [loading,      setLoading]    = useState(false)
  const [hasFetched,   setHasFetched] = useState(false)  // prevents infinite retry loop
  const [filter,       setFilter]     = useState<OrderFilter>('all')
  const [search,       setSearch]     = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function setSearchDebounced(val: string) {
    setSearch(val)
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => setDebouncedSearch(val), 300)
  }

  async function fetchOrders() {
    if (!token || loading) return
    setLoading(true)
    try {
      const d = await accountApi.getOrders(token, (newTk) => setToken(newTk))
      setOrders(d.orders || [])
    } catch (e: any) {
      console.error('[useOrders] fetch failed:', e.message)
      setOrders([])  // set to empty array so UI shows "no orders" not infinite loader
    } finally {
      setLoading(false)
      setHasFetched(true)
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
      const q  = debouncedSearch.toLowerCase().trim()
      const mQ = !q
        || (o.order_number || '').toLowerCase().includes(q)
        || (o.items || []).some((i: any) => (i.name || '').toLowerCase().includes(q))
      return mF && mQ
    })
  }, [orders, filter, debouncedSearch])

  function canReturn(o: any) {
    if ((o._displayStatus || o.order_status) !== 'delivered') return false
    if (!o.delivered_at && !o.updated_at) return true
    const days = (Date.now() - new Date(o.delivered_at || o.updated_at).getTime()) / 86_400_000
    return days <= 7
  }

  return { orders, loading, hasFetched, filter, setFilter: setFilter as (f: OrderFilter) => void, search, setSearch: setSearchDebounced, filtered, stats, fetchOrders, canReturn }
}
