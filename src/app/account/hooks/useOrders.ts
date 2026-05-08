// ─────────────────────────────────────────────────────────────
// useOrders — fetch + filter + search orders
//
// FIXES applied (audit):
//  ✅ Debounce timer cleanup on unmount (was leaking)
//  ✅ `any` replaced with typed Order in reduce/some/canReturn
//  ✅ AbortController added to fetchOrders (prevents stale updates)
//  ✅ canReturn now uses Order type
//
// KNOWN LIMITATIONS (acceptable for current scale):
//  ⚠️  Client-side filtering is fine for <500 orders.
//      For 2000+ orders, move filter/search params to the API call.
//      Requires backend pagination support.
// ─────────────────────────────────────────────────────────────
'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { accountApi } from '@/lib/account/api'
import { ACTIVE_STATUSES, RETURN_STATUSES } from '@/lib/account/constants'

export type OrderFilter = 'all' | 'active' | 'delivered' | 'returns' | 'cancelled'

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
  updated_at?:     string | null
  items:           OrderItem[]
  _return:         unknown | null
}

export function useOrders(token: string | null, setToken: (t: string) => void) {
  const [orders,          setOrders]         = useState<Order[] | null>(null)
  const [loading,         setLoading]        = useState(false)
  const [hasFetched,      setHasFetched]     = useState(false)
  const [filter,          setFilter]         = useState<OrderFilter>('all')
  const [search,          setSearch]         = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const debounceTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef       = useRef<AbortController | null>(null)

  // ── Cleanup debounce timer on unmount ─────────────────────
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      // Also cancel any in-flight fetch
      abortRef.current?.abort()
    }
  }, [])

  function setSearchDebounced(val: string) {
    setSearch(val)
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => setDebouncedSearch(val), 300)
  }

  async function fetchOrders() {
    if (!token || loading) return

    // Cancel any previous in-flight request
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    try {
      const d = await accountApi.getOrders(token, (newTk) => setToken(newTk))
      // Check if we were aborted before applying state
      if (abortRef.current?.signal.aborted) return
      setOrders((d.orders as Order[]) || [])
    } catch (e: unknown) {
      if (abortRef.current?.signal.aborted) return
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[useOrders] fetch failed:', msg)
      setOrders([])
    } finally {
      if (!abortRef.current?.signal.aborted) {
        setLoading(false)
        setHasFetched(true)
      }
    }
  }

  // ── Derived stats — typed, no `any` in reducers ───────────
  const stats = useMemo(() => {
    if (!orders) return null
    return {
      total:     orders.length,
      delivered: orders.filter(o => (o._displayStatus || o.order_status) === 'delivered').length,
      active:    orders.filter(o => ACTIVE_STATUSES.includes(o._displayStatus || o.order_status || '')).length,
      cancelled: orders.filter(o => (o._displayStatus || o.order_status) === 'cancelled').length,
      spent:     orders
        .filter(o => (o._displayStatus || o.order_status) !== 'cancelled')
        .reduce((s: number, o: Order) => s + (o.total_amount || 0), 0),
    }
  }, [orders])

  // ── Filtered + searched orders ────────────────────────────
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
        || (o.items || []).some((i: OrderItem) => (i.name || '').toLowerCase().includes(q))
      return mF && mQ
    })
  }, [orders, filter, debouncedSearch])

  // ── Return eligibility — typed, no `any` ─────────────────
  function canReturn(o: Order): boolean {
    if ((o._displayStatus || o.order_status) !== 'delivered') return false
    if (!o.delivered_at && !o.updated_at) return true
    const deliveredDate = o.delivered_at || o.updated_at
    if (!deliveredDate) return true
    const days = (Date.now() - new Date(deliveredDate).getTime()) / 86_400_000
    return days <= 7
  }

  return {
    orders,
    loading,
    hasFetched,
    filter,
    setFilter: setFilter as (f: OrderFilter) => void,
    search,
    setSearch: setSearchDebounced,
    filtered,
    stats,
    fetchOrders,
    canReturn,
  }
}
