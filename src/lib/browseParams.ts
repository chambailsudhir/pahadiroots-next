// ── Browse URL-parameter parsing ─────────────────────────────────────────
// BUG FIX (Issue 6, Oct 2026 audit): /products, /new-arrivals and
// /collections/[slug] each parsed their own searchParams with bare
// Math.max(1, parseInt(..)) / Number(..), which meant:
//   - ?page=abc          → NaN page → empty slice → "No products found"
//   - ?minPrice=abc      → NaN price → every product filtered out, "₹NaN" chip
//   - ?page=1&page=2     → arrives as an array at runtime despite the string type
//   - ?minPrice=500&maxPrice=300 → impossible range
// All parsing now lives here so every listing page validates the same way.
// Pure functions, no server/client dependency.

export type RawParam = string | string[] | undefined

/** Repeated params (?page=1&page=2) arrive as arrays at runtime — take the first. */
export function firstParam(v: RawParam): string | undefined {
  if (Array.isArray(v)) return v[0]
  return v
}

/** Integer page >= 1; anything else (NaN, 0, negatives, decimals-as-garbage) → 1. */
export function parsePage(v: RawParam): number {
  const raw = firstParam(v)
  if (!raw) return 1
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

/** Finite, non-negative number or undefined (invalid params are dropped, not NaN). */
export function parsePrice(v: RawParam): number | undefined {
  const raw = firstParam(v)
  if (raw == null || raw.trim() === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

export const SORT_VALUES = ['newest', 'price_asc', 'price_desc', 'popular'] as const

export function parseSort(v: RawParam): string {
  const raw = firstParam(v)
  return raw && (SORT_VALUES as readonly string[]).includes(raw) ? raw : 'newest'
}

export interface RawBrowseParams {
  sort?: RawParam
  category?: RawParam
  state?: RawParam
  page?: RawParam
  instock?: RawParam
  minPrice?: RawParam
  maxPrice?: RawParam
}

export interface BrowseParams {
  sort: string
  category: string
  state: string
  page: number
  instock: boolean
  minPrice?: number
  maxPrice?: number
}

export function parseBrowseParams(sp: RawBrowseParams): BrowseParams {
  let minPrice = parsePrice(sp.minPrice)
  let maxPrice = parsePrice(sp.maxPrice)
  // An inverted range (₹500–₹300) can only ever return nothing — swap it.
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    ;[minPrice, maxPrice] = [maxPrice, minPrice]
  }
  return {
    sort:     parseSort(sp.sort),
    category: firstParam(sp.category) || '',
    state:    firstParam(sp.state) || '',
    page:     parsePage(sp.page),
    instock:  firstParam(sp.instock) === 'true',
    minPrice,
    maxPrice,
  }
}
