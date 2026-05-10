'use client'
// ─────────────────────────────────────────────────────────────
// useOrders — pagination + server-side search + filter
//
//  ✅ Server-side search (?search=&status=&page=&limit=)
//  ✅ Pagination (page state, load more)
//  ✅ Stable fetchOrders via loadingRef (not `loading` state)
//  ✅ AbortController + 15s timeout (in orderService)
//  ✅ Retry/backoff in orderService
//  ✅ Zod validated via orderService
//  ✅ Debounce on search input
//  ✅ Timer cleanup on unmount
// ─────────────────────────────────────────────────────────────

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { fetchOrders, type Order } from '@/lib/services/orderService'
import { ACTIVE_STATUSES, RETURN_STATUSES } from '@/lib/account/constants'

export type OrderFilter = 'all' | 'active' | 'delivered' | 'returns' | 'cancelled'
export type { Order }

const PAGE_SIZE = 20

export function useOrders() {
  const [orders,     setOrders]     = useState<Order[] | null>(null)
  const [loading,    setLoading]    = useState(false)
  const [hasFetched, setHasFetched] = useState(false)
  const [filter,     setFilter]     = useState<OrderFilter>('all')
  const [search,     setSearch]     = useState('')
  const [page,       setPage]       = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  // Debounced search — sent to server
  const [serverSearch, setServerSearch] = useState('')
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef      = useRef<AbortController | null>(null)
  const loadingRef    = useRef(false)

  useEffect(() => () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    abortRef.current?.abort()
  }, [])

  function setSearchDebounced(val: string) {
    setSearch(val)
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      setServerSearch(val)
      setPage(1)      // reset to page 1 on new search
      setOrders(null) // clear so skeleton shows
    }, 400)
  }

  // Map UI filter → server status param
  const serverStatus = useMemo(() => {
    if (filter === 'active')    return ACTIVE_STATUSES.join(',')
    if (filter === 'delivered') return 'delivered'
    if (filter === 'returns')   return RETURN_STATUSES.join(',')
    if (filter === 'cancelled') return 'cancelled'
    return ''
  }, [filter])

  const fetchOrdersPage = useCallback(async (pageNum = 1, replace = true) => {
    if (loadingRef.current) return
    loadingRef.current = true
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    try {
      const data = await fetchOrders({
        page:   pageNum,
        limit:  PAGE_SIZE,
        search: serverSearch,
        status: serverStatus,
        signal: abortRef.current.signal,
      })
      setOrders(prev => replace ? data.orders : [...(prev || []), ...data.orders])
      setTotalPages(data.pages  ?? 1)
      setTotalCount(data.total  ?? data.orders.length)
      // Only update summary stats on first/full load (not on load-more appends)
      if (replace && data.stats) setServerStats(data.stats)
      setHasFetched(true)
    } catch {
      if (!abortRef.current?.signal.aborted) setOrders(prev => prev ?? [])
    } finally {
      loadingRef.current = false
      if (!abortRef.current?.signal.aborted) setLoading(false)
    }
  }, [serverSearch, serverStatus])

  // Re-fetch when server-side params change
  useEffect(() => {
    if (hasFetched) { fetchOrdersPage(1, true) }
  // fetchOrdersPage is stable (useCallback with [serverSearch, serverStatus])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSearch, serverStatus])

  function loadMore() {
    if (page < totalPages && !loading) {
      const next = page + 1
      setPage(next)
      fetchOrdersPage(next, false)  // append
    }
  }

  function handleFilterChange(f: OrderFilter) {
    setFilter(f)
    setPage(1)
    setOrders(null)
  }

  // Stats — fetched from API separately (server-side counts, not current page slice)
  const [serverStats, setServerStats] = useState<{
    delivered: number; active: number; cancelled: number; spent: number
  } | null>(null)

  const stats = useMemo(() => {
    if (!orders) return null
    // Use server-provided counts when available; fall back to page counts
    return {
      total:     totalCount,
      delivered: serverStats?.delivered ?? orders.filter(o => (o._displayStatus || o.order_status) === 'delivered').length,
      active:    serverStats?.active    ?? orders.filter(o => ACTIVE_STATUSES.includes(o._displayStatus || o.order_status || '')).length,
      cancelled: serverStats?.cancelled ?? orders.filter(o => (o._displayStatus || o.order_status) === 'cancelled').length,
      spent:     serverStats?.spent     ?? orders
        .filter(o => (o._displayStatus || o.order_status) !== 'cancelled')
        .reduce((s, o) => s + (o.total_amount || 0), 0),
    }
  }, [orders, totalCount, serverStats])

  // For backward compat — client-side filter is now just display (server already filtered)
  const filtered = orders ?? []

  function canReturn(o: Order): boolean {
    if ((o._displayStatus || o.order_status) !== 'delivered') return false
    const deliveredDate = o.delivered_at || o.updated_at
    if (!deliveredDate) return true
    return (Date.now() - new Date(deliveredDate).getTime()) / 86_400_000 <= 7
  }

  return {
    orders,
    loading,
    hasFetched,
    filter,
    setFilter: handleFilterChange,
    search,
    setSearch: setSearchDebounced,
    filtered,
    stats,
    fetchOrders: fetchOrdersPage,
    canReturn,
    // pagination
    page,
    totalPages,
    totalCount,
    loadMore,
    hasMore: page < totalPages,
  }
}
