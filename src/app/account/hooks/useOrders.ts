'use client'
// ─────────────────────────────────────────────────────────────
// useOrders — SWR-backed orders with pagination + server search
// Updated: stats now includes loyalty_points from RPC
// ─────────────────────────────────────────────────────────────

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import useSWR from 'swr'
import { fetchOrders, type Order, type OrdersResponse } from '@/lib/services/orderService'
import { ServiceError } from '@/lib/services/profileService'
import { ACTIVE_STATUSES, RETURN_STATUSES } from '@/lib/account/constants'
import { captureError } from '@/lib/logger'

export type OrderFilter = 'all' | 'active' | 'delivered' | 'returns' | 'cancelled'
export type { Order }

const PAGE_SIZE = 20

function toServerStatus(filter: OrderFilter): string {
  if (filter === 'active')    return ACTIVE_STATUSES.join(',')
  if (filter === 'delivered') return 'delivered'
  if (filter === 'returns')   return RETURN_STATUSES.join(',')
  if (filter === 'cancelled') return 'cancelled'
  return ''
}

async function ordersFetcher(
  _key:   string,
  page:   number,
  search: string,
  status: string,
  signal: AbortSignal,
): Promise<OrdersResponse> {
  return fetchOrders({ page, limit: PAGE_SIZE, search, status, signal })
}

export function useOrders(markExpired?: () => void) {
  const [enabled,      setEnabled]      = useState(false)
  const [filter,       setFilterState]  = useState<OrderFilter>('all')
  const [search,       setSearchInput]  = useState('')
  const [serverSearch, setServerSearch] = useState('')
  const [extraOrders,  setExtraOrders]  = useState<Order[]>([])
  const [loadedPage,   setLoadedPage]   = useState(1)
  const [totalPages,   setTotalPages]   = useState(1)
  const [loadingMore,  setLoadingMore]  = useState(false)

  // ── Updated: serverStats now carries loyalty_points ──────────
  const [serverStats, setServerStats] = useState<{
    delivered:      number
    active:         number
    cancelled:      number
    spent:          number
    loyalty_points: number   // ← new
  } | null>(null)

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef      = useRef<AbortController | null>(null)
  const serverStatus  = toServerStatus(filter)

  const swrKey = enabled
    ? ['orders', 1, serverSearch, serverStatus]
    : null

  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    ([_k, pg, sq, st]: [string, number, string, string]) => {
      abortRef.current?.abort()
      abortRef.current = new AbortController()
      return ordersFetcher(_k, pg as number, sq as string, st as string, abortRef.current.signal)
    },
    {
      revalidateOnFocus:     false,
      revalidateOnReconnect: true,
      dedupingInterval:      30_000,
      onSuccess: (res) => {
        if (res.stats) setServerStats(res.stats as typeof serverStats extends null ? never : NonNullable<typeof serverStats>)
        setExtraOrders([])
        setLoadedPage(1)
        setTotalPages(res.pages ?? 1)
      },
      onError: (err) => {
        if (err instanceof ServiceError && err.status === 401) {
          markExpired?.()
        } else {
          captureError(err, { action: 'useOrders/fetchOrders', page: 1, search: serverSearch, filter })
        }
      },
    }
  )

  useEffect(() => () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    abortRef.current?.abort()
  }, [])

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

  async function loadMore() {
    const next = loadedPage + 1
    if (next > totalPages || isLoading || loadingMore) return
    setLoadingMore(true)
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    try {
      const res = await fetchOrders({ page: next, limit: PAGE_SIZE, search: serverSearch, status: serverStatus, signal: abortRef.current.signal })
      setExtraOrders(prev => [...prev, ...res.orders])
      setLoadedPage(next)
    } catch (err) {
      if (err instanceof ServiceError && err.status === 401) {
        markExpired?.()
      } else {
        captureError(err, { action: 'useOrders/loadMore', page: next })
      }
    } finally {
      setLoadingMore(false)
    }
  }

  function canReturn(o: Order): boolean {
    if ((o._displayStatus || o.order_status) !== 'delivered') return false
    const deliveredDate = o.delivered_at || o.updated_at
    if (!deliveredDate) return true
    return (Date.now() - new Date(deliveredDate).getTime()) / 86_400_000 <= 7
  }

  const currentPageOrders = data?.orders ?? []
  const allOrders  = [...currentPageOrders, ...extraOrders]
  const totalCount = data?.total ?? 0
  const hasFetched = !!data || !!error

  const stats = useMemo(() => {
    if (!data) return null

    if (serverStats) {
      return {
        total:          totalCount,
        delivered:      serverStats.delivered,
        active:         serverStats.active,
        cancelled:      serverStats.cancelled,
        spent:          serverStats.spent,
        loyalty_points: serverStats.loyalty_points ?? 0,   // ← surfaced to sidebar
      }
    }

    // Slow path — fallback for when the get_customer_order_stats RPC call
    // fails or times out (see getStatsFromRpc in /api/orders/route.ts).
    // ⚠️  These counts are intentionally page-scoped: they reflect only the
    //     orders already loaded in `data.orders` (first page, max PAGE_SIZE=20)
    //     plus any extra pages fetched via loadMore. For customers with >20
    //     orders the sidebar counts will be partial whenever this fallback
    //     is hit. The RPC itself already exists in production (this is NOT
    //     a "pre-migration" placeholder) — see db_migration_v4_loyalty.sql
    //     for its original definition and db_migration_v9_fix_order_stats_active_filter.sql
    //     for a fix to its active-status filter (was missing 'processing').
    const all = [...(data?.orders ?? []), ...extraOrders]
    const counts = all.reduce(
      (acc, o) => {
        const status = o._displayStatus || o.order_status || ''
        if (status === 'delivered')                             acc.delivered++
        else if (ACTIVE_STATUSES.includes(status))             acc.active++
        else if (status === 'cancelled')                       acc.cancelled++
        if (status !== 'cancelled') acc.spent += o.total_amount || 0
        return acc
      },
      { delivered: 0, active: 0, cancelled: 0, spent: 0 }
    )
    return {
      total:          totalCount,
      delivered:      counts.delivered,
      active:         counts.active,
      cancelled:      counts.cancelled,
      spent:          counts.spent,
      loyalty_points: 0,   // unknown without RPC
    }
  }, [data, totalCount, serverStats, extraOrders])

  // BUG FIX: both were inline arrow literals in the return object, recreated
  // with a new reference on every render — the same instability pattern
  // fixed in useToast.ts's `show`. Everything each calls (useState setters,
  // SWR's `mutate`) is itself referentially stable, so an empty dependency
  // array is correct. This is what let account/page.tsx safely depend on
  // `orders.fetchOrders` instead of needing the whole unstable `orders`
  // object in its effect's dependency array.
  const stableFetchOrders = useCallback(() => setEnabled(true), [])
  const stableRefresh     = useCallback(() => { mutate(); setExtraOrders([]); setLoadedPage(1) }, [mutate])

  return {
    orders:      allOrders.length > 0 ? allOrders : null,
    loading:     isLoading,
    hasFetched,
    error:       error?.message ?? null,
    filter,      setFilter,
    search,      setSearch,
    filtered:    allOrders,
    stats,
    fetchOrders: stableFetchOrders,
    refresh:     stableRefresh,
    canReturn,
    page:        loadedPage,
    totalPages,
    totalCount,
    loadMore,
    loadingMore,
    hasMore: loadedPage < totalPages,
  }
}
