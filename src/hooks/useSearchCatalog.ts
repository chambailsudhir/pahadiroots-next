'use client'

import useSWR from 'swr'
import type { Product } from '@/types'

/**
 * useSearchCatalog — one shared fetch of the server-normalized catalogue for
 * both /search and the header SearchOverlay (same SWR key = one request, one
 * cache). Passing `enabled = false` skips the request entirely.
 *
 * Unlike the old direct-Supabase fetches, a failed request surfaces as `error`
 * so the UI can say so instead of showing "No products found".
 */
export const SEARCH_CATALOG_KEY = '/api/v1/search-catalog'

async function fetchSearchCatalog(url: string): Promise<Product[]> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`search-catalog ${res.status}`)
  const json = await res.json()
  return Array.isArray(json?.products) ? (json.products as Product[]) : []
}

export function useSearchCatalog(enabled: boolean) {
  return useSWR<Product[]>(enabled ? SEARCH_CATALOG_KEY : null, fetchSearchCatalog, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  })
}
