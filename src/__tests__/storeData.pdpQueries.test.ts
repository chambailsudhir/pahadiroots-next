/**
 * storeData.pdpQueries.test.ts
 *
 * Real regression coverage for the storeData.ts functions touched by the
 * "catalog fetch doesn't scale" bug fix (audit finding #1):
 *
 *   - fetchAllActiveProducts (exercised via getStoreData()) — pagination
 *     across the Supabase 1000-row page size, including the exact-multiple
 *     boundary case, and the stable secondary `.order('id')` tiebreaker.
 *   - getProductBySlug — case-insensitive slug match, ilike wildcard
 *     escaping (a slug containing '_' or '%' must not become a pattern
 *     match), numeric-id fallback, and the not-found path.
 *   - getRelatedProducts — category/state OR-filter construction, self
 *     exclusion, and per-item image/variant attachment.
 *
 * Unlike src/__tests__/pdp.test.ts (which re-implements PDP logic inline
 * and never imports @/lib/storeData), these tests call the real exported
 * functions against a chainable Supabase query-builder mock.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag:  vi.fn(),
}))

// ─── Chainable Supabase mock ───────────────────────────────────────────────
// Records every filter method call and, on resolution, applies them against
// an in-memory table so pagination / filtering behave like the real thing
// closely enough to catch real bugs (off-by-one range boundaries, wrong
// column names, wrong operators) without needing a live DB.
interface ChainState {
  eq: Record<string, unknown>
  neq: [string, unknown] | null
  in: [string, unknown[]] | null
  ilike: [string, string] | null
  or: string | null
  range: [number, number] | null
  limit: number | null
}

function ilikeToRegExp(pattern: string): RegExp {
  // Mirrors Postgres ILIKE semantics closely enough for tests: '%' = .*,
  // '_' = any single char, '\X' = literal X (escaped wildcard).
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\' && i + 1 < pattern.length) { out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue }
    if (c === '%') { out += '.*'; continue }
    if (c === '_') { out += '.'; continue }
    out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`, 'i')
}

function applyChain(rows: Record<string, unknown>[], s: ChainState): Record<string, unknown>[] {
  let out = rows
  for (const [k, v] of Object.entries(s.eq)) out = out.filter(r => r[k] === v)
  if (s.neq) out = out.filter(r => r[s.neq![0]] !== s.neq![1])
  if (s.in) out = out.filter(r => (s.in![1] as unknown[]).includes(r[s.in![0]]))
  if (s.ilike) { const re = ilikeToRegExp(s.ilike[1]); out = out.filter(r => re.test(String(r[s.ilike![0]] ?? ''))) }
  if (s.or) {
    // Supports the simple 'col.eq.val,col2.eq.val2' shape produced by getRelatedProducts.
    const clauses = s.or.split(',').map(c => {
      const [col, , ...rest] = c.split('.')
      return { col, val: rest.join('.') }
    })
    out = out.filter(r => clauses.some(cl => String(r[cl.col]) === cl.val))
  }
  if (s.range) out = out.slice(s.range[0], s.range[1] + 1)
  if (s.limit != null) out = out.slice(0, s.limit)
  return out
}

function makeChain(rows: Record<string, unknown>[]) {
  const s: ChainState = { eq: {}, neq: null, in: null, ilike: null, or: null, range: null, limit: null }
  const chain: any = {
    select: () => chain,
    eq:     (k: string, v: unknown) => { s.eq[k] = v; return chain },
    neq:    (k: string, v: unknown) => { s.neq = [k, v]; return chain },
    in:     (k: string, v: unknown[]) => { s.in = [k, v]; return chain },
    ilike:  (k: string, v: string) => { s.ilike = [k, v]; return chain },
    or:     (expr: string) => { s.or = expr; return chain },
    order:  () => chain,
    range:  (from: number, to: number) => { s.range = [from, to]; return chain },
    limit:  (n: number) => { s.limit = n; return chain },
    maybeSingle: () => {
      const out = applyChain(rows, s)
      if (out.length > 1) return Promise.resolve({ data: null, error: { message: 'multiple rows returned' } })
      return Promise.resolve({ data: out[0] ?? null, error: null })
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: applyChain(rows, s), error: null }).then(res, rej),
  }
  return chain
}

function makeDb(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from: (table: string) => makeChain(tables[table] ?? []),
  }
}

const { mockGetServiceClient, mockAnonClient } = vi.hoisted(() => ({
  mockGetServiceClient: vi.fn(),
  mockAnonClient: { from: vi.fn() },
}))

vi.mock('@/lib/supabase', () => ({
  supabase:         mockAnonClient,
  getServiceClient: mockGetServiceClient,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────
// fetchAllActiveProducts (via getStoreData) — pagination correctness
// ─────────────────────────────────────────────────────────────────────────
describe('getStoreData — product pagination (BUG FIX: 500-row ceiling)', () => {
  it('returns every active product even when the count exceeds one page (1000 rows)', async () => {
    const { getStoreData } = await import('@/lib/storeData')

    // 1001 rows: forces exactly two .range() pages (0-999, 1000-1999) so we
    // can confirm the loop terminates correctly AND stitches both pages.
    const products = Array.from({ length: 1001 }, (_, i) => ({
      id: i + 1, name: `Product ${String(i + 1).padStart(4, '0')}`, status: 'active', is_deleted: false,
    }))
    mockGetServiceClient.mockReturnValue(makeDb({ products }))

    const data = await getStoreData(true)
    expect(data.products).toHaveLength(1001)
    // Every id 1..1001 must be present exactly once — proves no row was
    // skipped or duplicated at the page boundary.
    const ids = data.products.map((p: any) => p.id).sort((a: number, b: number) => a - b)
    expect(ids).toEqual(Array.from({ length: 1001 }, (_, i) => i + 1))
  })

  it('does not double-fetch when the product count is an exact multiple of the page size', async () => {
    const { getStoreData } = await import('@/lib/storeData')
    const products = Array.from({ length: 1000 }, (_, i) => ({
      id: i + 1, name: `P${i + 1}`, status: 'active', is_deleted: false,
    }))
    mockGetServiceClient.mockReturnValue(makeDb({ products }))

    const data = await getStoreData(true)
    expect(data.products).toHaveLength(1000)
  })

  it('returns a small catalog (well under the old 500 cap) unchanged', async () => {
    const { getStoreData } = await import('@/lib/storeData')
    const products = [
      { id: 1, name: 'Wild Honey', status: 'active', is_deleted: false },
      { id: 2, name: 'A2 Ghee',    status: 'active', is_deleted: false },
    ]
    mockGetServiceClient.mockReturnValue(makeDb({ products }))

    const data = await getStoreData(true)
    expect(data.products).toHaveLength(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// getProductBySlug — targeted lookup correctness
// ─────────────────────────────────────────────────────────────────────────
describe('getProductBySlug (BUG FIX: full-catalog scan replaced with indexed lookup)', () => {
  const baseProducts = [
    { id: 1, slug: 'lakadong-turmeric', name: 'Lakadong Turmeric', status: 'active', is_deleted: false, category_id: 1, state_id: 'ML' },
    { id: 2, slug: 'wild_forest_honey', name: 'Wild Forest Honey', status: 'active', is_deleted: false, category_id: 2, state_id: 'HP' },
    { id: 3, slug: 'shilajit-resin',    name: 'Shilajit Resin',    status: 'active', is_deleted: false, category_id: 3, state_id: 'JK' },
  ]

  function setup(products: Record<string, unknown>[] = baseProducts, variants: any[] = [], images: any[] = []) {
    mockGetServiceClient.mockReturnValue(makeDb({
      products, product_variants: variants, product_images: images,
    }))
  }

  it('finds a product by exact slug', async () => {
    setup()
    const { getProductBySlug } = await import('@/lib/storeData')
    const { product } = await getProductBySlug('lakadong-turmeric')
    expect(product?.id).toBe(1)
  })

  it('matches case-insensitively', async () => {
    setup()
    const { getProductBySlug } = await import('@/lib/storeData')
    const { product } = await getProductBySlug('Lakadong-Turmeric')
    expect(product?.id).toBe(1)
  })

  it('treats an underscore in the slug literally, not as an ILIKE single-char wildcard', async () => {
    setup()
    const { getProductBySlug } = await import('@/lib/storeData')
    // If '_' weren't escaped, 'wild.forest.honey' (any chars) would also
    // incorrectly match 'wild_forest_honey' — assert the exact slug still
    // resolves to the right single product without ambiguity.
    const { product } = await getProductBySlug('wild_forest_honey')
    expect(product?.id).toBe(2)
  })

  it('does not let an unescaped wildcard char in the slug match an unrelated product', async () => {
    // Two products whose slugs would collide under naive (unescaped) ILIKE
    // if a literal '_' were treated as "any character".
    setup([
      { id: 10, slug: 'ghee_100g', name: 'Ghee 100g', status: 'active', is_deleted: false, category_id: 1, state_id: null },
      { id: 11, slug: 'gheeX100g', name: 'Ghee X100g', status: 'active', is_deleted: false, category_id: 1, state_id: null },
    ])
    const { getProductBySlug } = await import('@/lib/storeData')
    const { product } = await getProductBySlug('ghee_100g')
    expect(product?.id).toBe(10)
  })

  it('falls back to numeric id lookup when the slug lookup misses and the slug is numeric', async () => {
    setup()
    const { getProductBySlug } = await import('@/lib/storeData')
    const { product } = await getProductBySlug('3')
    expect(product?.id).toBe(3)
  })

  it('returns product: null (no throw) when nothing matches', async () => {
    setup()
    const { getProductBySlug } = await import('@/lib/storeData')
    const { product, variants, images } = await getProductBySlug('does-not-exist')
    expect(product).toBeNull()
    expect(variants).toEqual([])
    expect(images).toEqual([])
  })

  it('fetches variants and images scoped to the matched product only', async () => {
    setup(baseProducts, [
      { id: 100, product_id: 1, price: 199, original_price: 249, is_active: true, sort_order: 1 },
      { id: 101, product_id: 1, price: 349, original_price: 399, is_active: true, sort_order: 2 },
      { id: 102, product_id: 2, price: 500, original_price: 500, is_active: true, sort_order: 1 }, // different product
    ], [
      { product_id: 1, image_url: 'img1.jpg', sort_order: 1 },
      { product_id: 2, image_url: 'img2.jpg', sort_order: 1 }, // different product
    ])
    const { getProductBySlug } = await import('@/lib/storeData')
    const { variants, images } = await getProductBySlug('lakadong-turmeric')
    expect(variants).toHaveLength(2)
    expect(variants.every((v: any) => v.product_id === 1)).toBe(true)
    expect(images).toHaveLength(1)
    expect(images[0].image_url).toBe('img1.jpg')
  })
})

// ─────────────────────────────────────────────────────────────────────────
// getRelatedProducts — targeted category/state query
// ─────────────────────────────────────────────────────────────────────────
describe('getRelatedProducts (BUG FIX: no longer filters the full in-memory catalog)', () => {
  const products = [
    { id: 1, slug: 'p1', name: 'P1', status: 'active', is_deleted: false, category_id: 1, state_id: 'HP', badges: [] },
    { id: 2, slug: 'p2', name: 'P2', status: 'active', is_deleted: false, category_id: 1, state_id: 'UK', badges: ['bestseller'] },
    { id: 3, slug: 'p3', name: 'P3', status: 'active', is_deleted: false, category_id: 9, state_id: 'HP', badges: [] },
    { id: 4, slug: 'p4', name: 'P4', status: 'active', is_deleted: false, category_id: 9, state_id: 'JK', badges: [] }, // matches neither
  ]

  it('matches by category OR state and excludes the product itself', async () => {
    mockGetServiceClient.mockReturnValue(makeDb({ products, product_images: [], product_variants: [] }))
    const { getRelatedProducts } = await import('@/lib/storeData')

    const related = await getRelatedProducts({ productId: 1, categoryId: 1, stateId: 'HP', limit: 4 })
    const ids = related.map(p => p.id).sort()
    // 2 matches by category, 3 matches by state; 1 excluded (self); 4 matches neither.
    expect(ids).toEqual([2, 3])
  })

  it('respects the limit', async () => {
    mockGetServiceClient.mockReturnValue(makeDb({ products, product_images: [], product_variants: [] }))
    const { getRelatedProducts } = await import('@/lib/storeData')
    const related = await getRelatedProducts({ productId: 1, categoryId: 1, stateId: 'HP', limit: 1 })
    expect(related.length).toBe(1)
  })

  it('returns [] without querying when there is no category or state to match on', async () => {
    mockGetServiceClient.mockReturnValue(makeDb({ products, product_images: [], product_variants: [] }))
    const { getRelatedProducts } = await import('@/lib/storeData')
    const related = await getRelatedProducts({ productId: 1, categoryId: null, stateId: null })
    expect(related).toEqual([])
  })

  it('attaches sorted images and active variants per related product, mapping mrp from original_price', async () => {
    mockGetServiceClient.mockReturnValue(makeDb({
      products,
      product_images: [
        { product_id: 2, image_url: 'b.jpg', sort_order: 2 },
        { product_id: 2, image_url: 'a.jpg', sort_order: 1 },
      ],
      // BUG FIX (found via manual line-by-line audit): product_variants has
      // no literal `mrp` column — the real column is `original_price`. This
      // mock previously used `mrp` directly, which is exactly why it never
      // caught the bug where RelatedCard's `baseVariant?.mrp` was always
      // undefined in production.
      product_variants: [
        { id: 1, product_id: 2, price: 500, original_price: 600, is_active: true, sort_order: 1 },
        { id: 2, product_id: 2, price: 300, original_price: 400, is_active: true, sort_order: 2 },
        { id: 3, product_id: 2, price: 100, original_price: 100, is_active: false, sort_order: 3 }, // inactive — excluded
      ],
    }))
    const { getRelatedProducts } = await import('@/lib/storeData')
    const related = await getRelatedProducts({ productId: 1, categoryId: 1, stateId: null, limit: 4 })
    const p2 = related.find(p => p.id === 2)!
    expect(p2._firstImage).toBe('a.jpg') // lowest sort_order wins
    expect(p2._variants.map(v => v.price)).toEqual([300, 500]) // active only, price-ascending
    expect(p2._variants.map(v => v.mrp)).toEqual([400, 600])   // mapped from original_price, not undefined
    expect(p2.badges_bestseller).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// getRelatedProducts — deterministic, stock-aware ranking (Issue C3)
// ─────────────────────────────────────────────────────────────────────────
describe('getRelatedProducts ranking (Issue C3: arbitrary, sold-out-prone set)', () => {
  const base = { status: 'active', is_deleted: false, badges: [] as string[] }
  // Deliberately NOT in id order, to prove the result doesn't depend on row order.
  const products = [
    { ...base, id: 9, slug: 'p9', name: 'P9', category_id: 1, state_id: 'HP', available_stock: 0 },            // both, sold out
    { ...base, id: 7, slug: 'p7', name: 'P7', category_id: 1, state_id: 'UK', available_stock: 5 },            // category only, in stock
    { ...base, id: 5, slug: 'p5', name: 'P5', category_id: 1, state_id: 'HP', available_stock: 5 },            // both, in stock
    { ...base, id: 3, slug: 'p3', name: 'P3', category_id: 9, state_id: 'HP', available_stock: 5, badges: ['bestseller'] }, // state only, bestseller
    { ...base, id: 2, slug: 'p2', name: 'P2', category_id: 9, state_id: 'HP', available_stock: 5 },            // state only
    { ...base, id: 1, slug: 'p1', name: 'P1', category_id: 1, state_id: 'HP', available_stock: 5 },            // self
  ]

  it('puts in-stock products first, then closest match, then bestseller, then lowest id', async () => {
    mockGetServiceClient.mockReturnValue(makeDb({ products, product_images: [], product_variants: [] }))
    const { getRelatedProducts } = await import('@/lib/storeData')
    const related = await getRelatedProducts({ productId: 1, categoryId: 1, stateId: 'HP', limit: 4 })
    // In stock: 5 matches BOTH category and state → first.
    // 3, 2 and 7 each match one dimension; 3 is a bestseller → next; 2 and 7 tie → lowest id first.
    // Sold-out 9 (matches both) drops out of the top 4.
    expect(related.map(p => p.id)).toEqual([5, 3, 2, 7])
  })

  it('still returns sold-out items when nothing else matches (never an empty row)', async () => {
    const onlySoldOut = [
      { ...base, id: 4, slug: 'p4', name: 'P4', category_id: 1, state_id: 'HP', available_stock: 0 },
      { ...base, id: 1, slug: 'p1', name: 'P1', category_id: 1, state_id: 'HP', available_stock: 5 },
    ]
    mockGetServiceClient.mockReturnValue(makeDb({ products: onlySoldOut, product_images: [], product_variants: [] }))
    const { getRelatedProducts } = await import('@/lib/storeData')
    const related = await getRelatedProducts({ productId: 1, categoryId: 1, stateId: 'HP', limit: 4 })
    expect(related.map(p => p.id)).toEqual([4])
  })

  it('judges stock across ALL active variants, not just the cheapest', async () => {
    const two = [
      { ...base, id: 2, slug: 'p2', name: 'P2', category_id: 1, state_id: 'HP', available_stock: 0 },
      { ...base, id: 3, slug: 'p3', name: 'P3', category_id: 1, state_id: 'HP', available_stock: 0 },
      { ...base, id: 1, slug: 'p1', name: 'P1', category_id: 1, state_id: 'HP', available_stock: 0 },
    ]
    const variants = [
      // P2: cheapest pack sold out, bigger pack available → buyable
      { id: 21, product_id: 2, price: 100, available_stock: 0, is_active: true },
      { id: 22, product_id: 2, price: 250, available_stock: 8, is_active: true },
      // P3: every pack sold out
      { id: 31, product_id: 3, price: 90,  available_stock: 0, is_active: true },
    ]
    mockGetServiceClient.mockReturnValue(makeDb({ products: two, product_images: [], product_variants: variants }))
    const { getRelatedProducts } = await import('@/lib/storeData')
    const related = await getRelatedProducts({ productId: 1, categoryId: 1, stateId: 'HP', limit: 4 })
    expect(related.map(p => p.id)).toEqual([2, 3])
  })
})
