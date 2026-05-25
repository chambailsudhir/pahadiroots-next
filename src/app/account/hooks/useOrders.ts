'use client'
// ─────────────────────────────────────────────────────────────
// useOrders — SWR-backed orders with pagination + server search
//
//  ✅ SWR caching — deduplication, revalidate on reconnect
//  ✅ Server-side search/filter/pagination
//  ✅ Abort controller + 15s timeout (in orderService)
//  ✅ Retry/backoff via SWR + orderService
//  ✅ Debounced search (400ms)
//  ✅ Load-more (append pages)
//  ✅ Zod validated via orderService
//  ✅ Structured logging via logger
// ─────────────────────────────────────────────────────────────

import { useState, useMemo, useRef, useEffect } from 'react'
import useSWR from 'swr'
import { fetchOrders, type Order, type OrdersResponse } from '@/lib/services/orderService'
import { ACTIVE_STATUSES, RETURN_STATUSES } from '@/lib/account/constants'
import { captureError } from '@/lib/logger'

export type OrderFilter = 'all' | 'active' | 'delivered' | 'returns' | 'cancelled'
export type { Order }

const PAGE_SIZE = 20

// Map UI filter → server status string
function toServerStatus(filter: OrderFilter): string {
  if (filter === 'active')    return ACTIVE_STATUSES.join(',')
  if (filter === 'delivered') return 'delivered'
  if (filter === 'returns')   return RETURN_STATUSES.join(',')
  if (filter === 'cancelled') return 'cancelled'
  return ''
}

// SWR fetcher — uses orderService (retry, timeout, zod all inside)
async function ordersFetcher(
  _key: string,
  page: number,
  search: string,
  status: string,
  signal: AbortSignal,
): Promise<OrdersResponse> {
  return fetchOrders({ page, limit: PAGE_SIZE, search, status, signal })
}

export function useOrders() {
  const [enabled,     setEnabled]     = useState(false)   // lazy — only fetch after login confirmed
  const [filter,      setFilterState] = useState<OrderFilter>('all')
  const [search,      setSearchInput] = useState('')
  const [serverSearch,setServerSearch]= useState('')
  // SWR key is ALWAYS page 1 — load-more fetches extra pages directly and
  // accumulates them in extraOrders without changing the SWR key.
  // (Previously setPage(next) changed the SWR key, causing SWR to also
  //  fetch page N+1 into currentPageOrders, then allOrders merged page N+1
  //  with the already-appended extraOrders of page N+1 — doubling every Load More.)
  const [extraOrders, setExtraOrders] = useState<Order[]>([])  // load-more appended pages
  const [loadedPage,  setLoadedPage]  = useState(1)            // tracks how many pages are loaded (for hasMore)
  const [totalPages,  setTotalPages]  = useState(1)            // kept in sync from SWR + loadMore results
  const [serverStats, setServerStats] = useState<{ delivered: number; active: number; cancelled: number; spent: number } | null>(null)

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef      = useRef<AbortController | null>(null)
  const serverStatus  = toServerStatus(filter)

  // SWR key — always page 1; load-more fetches extra pages imperatively
  const swrKey = enabled
    ? ['orders', 1, serverSearch, serverStatus]
    : null  // null = disabled (SWR won't fetch)

  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    ([_k, pg, sq, st]: [string, number, string, string]) => {
      abortRef.current?.abort()
      abortRef.current = new AbortController()
      return ordersFetcher(_k, pg as number, sq as string, st as string, abortRef.current.signal)
    },
    {
      revalidateOnFocus:     false,   // don't re-fetch when user switches tabs
      revalidateOnReconnect: true,    // re-fetch after network reconnect
      dedupingInterval:      30_000,  // cache for 30s — avoid double fetch
      onSuccess: (res) => {
        if (res.stats) setServerStats(res.stats)
        // When filter/search changes, SWR re-fetches page 1 — reset accumulated pages
        setExtraOrders([])
        setLoadedPage(1)
        setTotalPages(res.pages ?? 1)
      },
      onError: (err) => {
        captureError(err, { action: 'useOrders/fetchOrders', page: 1, search: serverSearch, filter })
      },
    }
  )

  // Cleanup abort on unmount
  useEffect(() => () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    abortRef.current?.abort()
  }, [])

  // Debounced search → server
  function setSearch(val: string) {
    setSearchInput(val)
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      setServerSearch(val)
      setExtraOrders([])
      setLoadedPage(1)
    }, 400)
  }

  function setFilter(f: OrderFilter) {
    setFilterState(f)
    setExtraOrders([])
    setLoadedPage(1)
  }

  // Load more — fetch next page imperatively and APPEND to extraOrders.
  // The SWR key stays on page 1, so SWR never re-fetches page N+1 on its own.
  // This prevents the old bug where setPage(next) changed the SWR key, causing
  // SWR to also fetch page N+1 into currentPageOrders, then allOrders merged
  // page N+1 with the already-appended extraOrders — doubling every Load More.
  async function loadMore() {
    const next = loadedPage + 1
    if (next > totalPages || isLoading) return
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    try {
      const res = await fetchOrders({ page: next, limit: PAGE_SIZE, search: serverSearch, status: serverStatus, signal: abortRef.current.signal })
      setExtraOrders(prev => [...prev, ...res.orders])
      setLoadedPage(next)
    } catch (err) {
      captureError(err, { action: 'useOrders/loadMore', page: next })
    }
  }

  function canReturn(o: Order): boolean {
    if ((o._displayStatus || o.order_status) !== 'delivered') return false
    const deliveredDate = o.delivered_at || o.updated_at
    if (!deliveredDate) return true
    return (Date.now() - new Date(deliveredDate).getTime()) / 86_400_000 <= 7
  }

  // Merge current page + appended pages
  const currentPageOrders = data?.orders ?? []
  // SWR always gives us page 1 orders; extraOrders holds pages 2, 3, etc.
  const allOrders  = [...currentPageOrders, ...extraOrders]
  const totalCount = data?.total ?? 0
  const hasFetched = !!data || !!error

  const stats = useMemo(() => {
    if (!data) return null
    return {
      total:     totalCount,
      delivered: serverStats?.delivered ?? allOrders.filter(o => (o._displayStatus || o.order_status) === 'delivered').length,
      active:    serverStats?.active    ?? allOrders.filter(o => ACTIVE_STATUSES.includes(o._displayStatus || o.order_status || '')).length,
      cancelled: serverStats?.cancelled ?? allOrders.filter(o => (o._displayStatus || o.order_status) === 'cancelled').length,
      spent:     serverStats?.spent     ?? allOrders
        .filter(o => (o._displayStatus || o.order_status) !== 'cancelled')
        .reduce((s, o) => s + (o.total_amount || 0), 0),
    }
  }, [data, totalCount, serverStats, allOrders])

  return {
    orders:     allOrders.length > 0 ? allOrders : null,
    loading:    isLoading,
    hasFetched,
    error:      error?.message ?? null,
    filter,     setFilter,
    search,     setSearch,
    filtered:   allOrders,
    stats,
    // Trigger initial fetch (called from page.tsx after auth confirmed)
    fetchOrders: () => setEnabled(true),
    // Force refresh (e.g. after return request)
    refresh: () => { mutate(); setExtraOrders([]); setLoadedPage(1) },
    canReturn,
    page:       loadedPage,
    totalPages,
    totalCount,
    loadMore,
    hasMore: loadedPage < totalPages,
  }
}
