import { describe, it, expect, vi, beforeEach } from 'vitest'

const state: {
  products: unknown[] | null; error: unknown; variants: unknown[]; storeOpen: string | null
  ranges: { table: string; from: number; to: number }[]
} = { products: [], error: null, variants: [], storeOpen: null, ranges: [] }

vi.mock('@/lib/supabase', () => {
  const chain = (table: string) => {
    let range: [number, number] | null = null
    const q: any = {
      select: () => q, eq: () => q, in: () => q, order: () => q,
      range: (from: number, to: number) => { range = [from, to]; state.ranges.push({ table, from, to }); return q },
      then: (res: any) => {
        const page = (rows: unknown[] | null) => (rows && range ? rows.slice(range[0], range[1] + 1) : rows)
        if (table === 'products') return res({ data: page(state.products), error: state.error })
        if (table === 'product_variants') return res({ data: page(state.variants), error: null })
        if (table === 'site_settings') return res({ data: state.storeOpen === null ? [] : [{ value: state.storeOpen }], error: null })
        return res({ data: [], error: null })
      },
    }
    return q
  }
  return { supabase: { from: (t: string) => chain(t) } }
})
import { GET } from '@/app/feeds/google-merchant.xml/route'

const product = (id: number) => ({ id, slug: `p${id}`, name: `P${id}`, short_description: 's', description: 'd', image_url: 'https://x/y.jpg', weight_grams: 250, categories: { name: 'Honey' } })

beforeEach(() => { state.variants = []; state.storeOpen = null; state.ranges = []; state.error = null })

describe('Merchant feed never publishes an empty (delisting) feed', () => {
  it('no rows → 503, not a valid empty 200', async () => {
    state.products = []; state.error = null
    expect((await GET()).status).toBe(503)
  })
  it('query error → 503', async () => {
    state.products = null; state.error = { message: 'boom' }
    expect((await GET()).status).toBe(503)
  })
  it('real products → 200 xml', async () => {
    state.products = [product(1)]
    state.error = null
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toMatch(/xml/)
  })
})

// Nov 2026 verification
describe('Merchant feed — store closed and >1000 rows', () => {
  it('store closed (exempt from the proxy gate by its .xml extension) → every item out_of_stock', async () => {
    state.products = [product(1)]
    state.variants = [{ id: 10, product_id: 1, variant_value: '250g', price: 199, original_price: null, compare_at_price: null, available_stock: 40, sku: null }]
    state.storeOpen = 'false'
    const xml = await (await GET()).text()
    expect(xml).toContain('<g:availability>out_of_stock</g:availability>')
    expect(xml).not.toContain('in_stock')
  })
  it('store open → stock decides availability', async () => {
    state.products = [product(1)]
    state.variants = [{ id: 10, product_id: 1, variant_value: '250g', price: 199, original_price: null, compare_at_price: null, available_stock: 40, sku: null }]
    state.storeOpen = 'true'
    expect(await (await GET()).text()).toContain('<g:availability>in_stock</g:availability>')
  })
  it('pages products past Supabase\'s 1,000-row cap', async () => {
    state.products = Array.from({ length: 1500 }, (_, i) => product(i + 1))
    state.variants = []
    const xml = await (await GET()).text()
    // No variants → no items, but both product pages must have been read.
    expect(state.ranges.filter(r => r.table === 'products').map(r => r.from)).toEqual([0, 1000])
    expect(xml).toContain('<rss')
  })
  it('pages variants past 1,000 rows', async () => {
    state.products = [product(1)]
    state.variants = Array.from({ length: 1200 }, (_, i) => ({ id: i + 1, product_id: 1, variant_value: `v${i}`, price: 10, original_price: null, compare_at_price: null, available_stock: 1, sku: null }))
    const xml = await (await GET()).text()
    expect(xml.match(/<item>/g)).toHaveLength(1200)
  })
})
