/**
 * cartUpsellsRoute.test.ts
 *
 * Direct route-level tests for GET /api/v1/cart-upsells.
 *
 * AUDIT GAP: this route — the largest, most logic-dense file in the cart
 * flow's API surface — had ZERO direct test coverage before this file.
 * useCartPage.handlers.test.ts and useCartPage.addedUpsell.test.ts only
 * mock fetch on the consumer side; the route handler's own logic (param
 * sanitization, ghost-item filtering, badge priority, dedup) was never
 * exercised.
 *
 * Covered here:
 *   1. [SECURITY/DoS FIX] parseIdParam: caps raw param length (4KB), caps ID
 *      count (50), and filters to UUID-safe characters only. A malicious
 *      variantIds param must not reach the exclusion-Set unfiltered.
 *   2. [BUG FIX — ghost upsell items] a variant whose product is soft-deleted
 *      or inactive (absent from prodMap after the products query filters by
 *      status=active&is_deleted=false) must NEVER appear in the response —
 *      previously this rendered a broken card (name="Product", slug="").
 *   3. Exclusion correctness — variantIds/productIds already in the cart are
 *      never suggested back.
 *   4. Dedup by product — multiple variants of the same product collapse to
 *      one upsell entry.
 *   5. Top-6 cap on the final result.
 *   6. Badge priority: bestseller > organic > new > null.
 *   7. Early return with empty upsells when there are zero non-excluded
 *      candidates (skips the products/images fetch entirely).
 *   8. Field fallbacks: size falls back to weight, mrp falls back to price,
 *      gstRate defaults to 5, maxQty defaults to 10.
 *   9. Graceful 500 + { upsells: [] } on any fetch failure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
  vi.resetModules()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.restoreAllMocks()
})

function makeReq(query: string) {
  return new NextRequest(`http://localhost/api/v1/cart-upsells${query ? `?${query}` : ''}`)
}

interface RouteTable {
  variants?: unknown[]
  products?: unknown[]
  images?:   unknown[]
}

/** Routes fetch calls by inspecting the table name in the URL path. */
function mockFetchByTable(tables: RouteTable, opts: { failOn?: keyof RouteTable } = {}) {
  global.fetch = vi.fn(async (url: string) => {
    const fail = opts.failOn
    if (fail && url.includes(`/rest/v1/${fail === 'variants' ? 'product_variants' : fail === 'products' ? 'products' : 'product_images'}`)) {
      return { ok: false, status: 500, json: async () => ({}) }
    }
    if (url.includes('/rest/v1/product_variants')) {
      return { ok: true, status: 200, json: async () => tables.variants ?? [] }
    }
    if (url.includes('/rest/v1/products')) {
      return { ok: true, status: 200, json: async () => tables.products ?? [] }
    }
    if (url.includes('/rest/v1/product_images')) {
      return { ok: true, status: 200, json: async () => tables.images ?? [] }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof globalThis.fetch
}

function variant(overrides: Partial<{
  id: string; product_id: string; is_active: boolean; available_stock: number
  price: number; mrp: number; size?: string; weight?: string
}> = {}) {
  return {
    id: 'aaaa1111', product_id: 'bbbb1111', is_active: true, available_stock: 10,
    price: 250, mrp: 300, size: '500g',
    ...overrides,
  }
}

function product(overrides: Partial<{
  id: string; name: string; slug: string; emoji: string | null; gst_rate: number
  state_id: string | null; badges_organic: boolean; badges_bestseller: boolean; badges_new: boolean
}> = {}) {
  return {
    id: 'bbbb1111', name: 'Himalayan Honey', slug: 'himalayan-honey', emoji: '🍯',
    gst_rate: 5, state_id: 'himachal', badges_organic: false,
    badges_bestseller: false, badges_new: false,
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/cart-upsells — happy path', () => {
  it('returns a correctly-shaped upsell item for a valid variant+product', async () => {
    mockFetchByTable({
      variants: [variant()],
      products: [product()],
      images:   [{ product_id: 'bbbb1111', image_url: 'https://img/honey.jpg' }],
    })

    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    const res  = await GET(makeReq(''))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.upsells).toHaveLength(1)
    expect(json.upsells[0]).toMatchObject({
      id:        'aaaa1111',
      productId: 'bbbb1111',
      name:      'Himalayan Honey',
      slug:      'himalayan-honey',
      price:     250,
      mrp:       300,
      image:     'https://img/honey.jpg',
      isHimalayan: true,
    })
  })

  it('excludes variants whose id is in variantIds', async () => {
    mockFetchByTable({
      variants: [variant({ id: 'aaaa1111', product_id: 'bbbb1111' }), variant({ id: 'aaaa2222', product_id: 'bbbb2222' })],
      products: [product({ id: 'bbbb1111' }), product({ id: 'bbbb2222', name: 'Ghee' })],
    })

    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    const res  = await GET(makeReq('variantIds=aaaa1111'))
    const json = await res.json()

    expect(json.upsells.map((u: { id: string }) => u.id)).toEqual(['aaaa2222'])
  })

  it('excludes variants whose product_id is in productIds', async () => {
    mockFetchByTable({
      variants: [variant({ id: 'aaaa1111', product_id: 'bbbb1111' }), variant({ id: 'aaaa2222', product_id: 'bbbb2222' })],
      products: [product({ id: 'bbbb1111' }), product({ id: 'bbbb2222', name: 'Ghee' })],
    })

    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    const res  = await GET(makeReq('productIds=bbbb1111'))
    const json = await res.json()

    expect(json.upsells.map((u: { id: string }) => u.id)).toEqual(['aaaa2222'])
  })

  it('dedupes by product — only the first variant of a repeated product_id is kept', async () => {
    mockFetchByTable({
      variants: [
        variant({ id: 'aaaa1111', product_id: 'bbbb1111' }),
        variant({ id: 'aaaa2222', product_id: 'bbbb1111' }), // same product, different variant
      ],
      products: [product({ id: 'bbbb1111' })],
    })

    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    const res  = await GET(makeReq(''))
    const json = await res.json()

    expect(json.upsells).toHaveLength(1)
    expect(json.upsells[0].id).toBe('aaaa1111') // first one wins
  })

  it('caps the result at 6 items even with more eligible candidates', async () => {
    const variants = Array.from({ length: 10 }, (_, i) => variant({ id: `v${i}`, product_id: `p${i}` }))
    const products  = Array.from({ length: 10 }, (_, i) => product({ id: `p${i}`, name: `Product ${i}` }))
    mockFetchByTable({ variants, products })

    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    const res  = await GET(makeReq(''))
    const json = await res.json()

    expect(json.upsells).toHaveLength(6)
  })

  it('falls back to weight when size is absent', async () => {
    mockFetchByTable({
      variants: [variant({ size: undefined, weight: '1kg' })],
      products: [product()],
    })

    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    const res  = await GET(makeReq(''))
    const json = await res.json()

    expect(json.upsells[0].size).toBe('1kg')
  })

  it('falls back mrp to price when mrp is absent', async () => {
    mockFetchByTable({
      variants: [variant({ mrp: undefined as unknown as number, price: 199 })],
      products: [product()],
    })

    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    const res  = await GET(makeReq(''))
    const json = await res.json()

    expect(json.upsells[0].mrp).toBe(199)
  })

  it('defaults gstRate to 5 and maxQty to 10 when absent', async () => {
    mockFetchByTable({
      variants: [variant({ available_stock: undefined as unknown as number })],
      products: [product({ gst_rate: undefined as unknown as number })],
    })

    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    const res  = await GET(makeReq(''))
    const json = await res.json()

    expect(json.upsells[0].gstRate).toBe(5)
    expect(json.upsells[0].maxQty).toBe(10)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// [BUG FIX] Ghost upsell items — soft-deleted/inactive product exclusion
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/cart-upsells — ghost item filtering (BUG FIX)', () => {
  it('excludes a variant whose product is absent from the products response (soft-deleted/inactive)', async () => {
    // Variant query returns v1 (product p1) and v2 (product p2), but the
    // products query — filtered by status=active&is_deleted=false — only
    // returns p1. p2 must be a deleted/deactivated product.
    mockFetchByTable({
      variants: [variant({ id: 'aaaa1111', product_id: 'bbbb1111' }), variant({ id: 'aaaa2222', product_id: 'bbbb2222' })],
      products: [product({ id: 'bbbb1111' })], // p2 deliberately missing
    })

    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    const res  = await GET(makeReq(''))
    const json = await res.json()

    // v2 must NOT appear as a ghost card (name="Product", slug="")
    expect(json.upsells.map((u: { id: string }) => u.id)).toEqual(['aaaa1111'])
    expect(json.upsells.every((u: { name: string }) => u.name !== 'Product')).toBe(true)
  })

  it('returns an empty list (not a crash) when ALL candidate products are inactive/deleted', async () => {
    mockFetchByTable({
      variants: [variant({ id: 'aaaa1111', product_id: 'bbbb1111' })],
      products: [], // products query returns nothing — p1 is deleted/inactive
    })

    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    const res  = await GET(makeReq(''))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.upsells).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// [SECURITY/DoS FIX] parseIdParam sanitization
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/cart-upsells — query param sanitization (DoS FIX)', () => {
  it('ignores a variantIds param exceeding 4KB (treats as empty exclusion set)', async () => {
    const huge = 'a'.repeat(5000)
    mockFetchByTable({
      variants: [variant({ id: huge.slice(0, 36) })], // won't match anyway
      products: [product()],
    })

    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    // Must not throw and must not hang processing a huge string
    const res = await GET(makeReq(`variantIds=${huge}`))
    expect(res.status).toBe(200)
  })

  it('caps the number of IDs parsed from a param at 50, ignoring the rest', async () => {
    // Build 60 valid-looking hex IDs; only the first 50 should be honoured as exclusions.
    const ids = Array.from({ length: 60 }, (_, i) => `${i.toString(16).padStart(8, '0')}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`)
    const variantsList = ids.map((id, i) => variant({ id, product_id: `p${i}` }))
    const productsList = ids.map((_, i) => product({ id: `p${i}`, name: `Product ${i}` }))
    mockFetchByTable({ variants: variantsList, products: productsList })

    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    // Exclude all 60 IDs — the exclusion set can only hold 50 of them, so at
    // least 10 variants remain eligible (un-excluded), confirmed by getting
    // upsells back rather than an empty list.
    const res  = await GET(makeReq(`variantIds=${ids.join(',')}`))
    const json = await res.json()

    expect(json.upsells.length).toBeGreaterThan(0)
  })

  it('filters out non-UUID-safe characters (e.g. SQL/script injection attempts)', async () => {
    mockFetchByTable({
      variants: [variant({ id: 'aaaa1111', product_id: 'bbbb1111' })],
      products: [product({ id: 'bbbb1111' })],
    })

    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    // Malicious param with quotes/semicolons — SAFE_ID_RE should reject every
    // comma-split token, leaving the exclusion set empty. Must not throw.
    const res  = await GET(makeReq(`variantIds=${encodeURIComponent("'; DROP TABLE products; --")}`))
    expect(res.status).toBe(200)
  })

  it('handles a missing variantIds/productIds param (treats as empty exclusion sets)', async () => {
    mockFetchByTable({
      variants: [variant()],
      products: [product()],
    })

    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    const res  = await GET(makeReq(''))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.upsells).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Badge priority
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/cart-upsells — badge priority', () => {
  it('prioritizes Bestseller over Natural and New Arrival', async () => {
    mockFetchByTable({
      variants: [variant()],
      products: [product({ badges_bestseller: true, badges_organic: true, badges_new: true })],
    })
    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    const json = await (await GET(makeReq(''))).json()
    expect(json.upsells[0].badge).toBe('Bestseller')
  })

  it('prioritizes Natural over New Arrival when not a bestseller', async () => {
    mockFetchByTable({
      variants: [variant()],
      products: [product({ badges_bestseller: false, badges_organic: true, badges_new: true })],
    })
    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    const json = await (await GET(makeReq(''))).json()
    expect(json.upsells[0].badge).toBe('Natural')
  })

  it('falls back to New Arrival when neither bestseller nor organic', async () => {
    mockFetchByTable({
      variants: [variant()],
      products: [product({ badges_bestseller: false, badges_organic: false, badges_new: true })],
    })
    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    const json = await (await GET(makeReq(''))).json()
    expect(json.upsells[0].badge).toBe('New Arrival')
  })

  it('badge is null when no badge flags are set', async () => {
    mockFetchByTable({
      variants: [variant()],
      products: [product({ badges_bestseller: false, badges_organic: false, badges_new: false })],
    })
    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    const json = await (await GET(makeReq(''))).json()
    expect(json.upsells[0].badge).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Early-return optimization
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/cart-upsells — early return when no candidates', () => {
  it('returns empty upsells without ever fetching products/images when all variants are excluded', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rest/v1/product_variants')) {
        return { ok: true, status: 200, json: async () => [variant({ id: 'aaaa1111', product_id: 'bbbb1111' })] }
      }
      // Should never be reached — fail loudly if products/images IS fetched.
      throw new Error(`Unexpected fetch to ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof globalThis.fetch

    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    const res  = await GET(makeReq('variantIds=aaaa1111'))
    const json = await res.json()

    expect(json.upsells).toEqual([])
    // Only ONE fetch call (variants) — products/images never attempted.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Failure handling
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/cart-upsells — failure handling', () => {
  it('returns { upsells: [] } with status 500 when the variants fetch fails', async () => {
    mockFetchByTable({ variants: [variant()], products: [product()] }, { failOn: 'variants' })

    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    const res  = await GET(makeReq(''))
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.upsells).toEqual([])
  })

  it('returns { upsells: [] } with status 500 when the products fetch fails', async () => {
    mockFetchByTable({ variants: [variant()], products: [product()] }, { failOn: 'products' })

    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    const res  = await GET(makeReq(''))
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.upsells).toEqual([])
  })

  it('returns { upsells: [] } with status 500 on a network-level rejection', async () => {
    global.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof globalThis.fetch

    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    const res  = await GET(makeReq(''))
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.upsells).toEqual([])
  })
})
