/** C1 — server-side live view of cart lines (same rules as createOrder). */
import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', () => ({ supabase: {}, getServiceClient: vi.fn() }))

import { validateCartLines, variantLinePrice, productLinePrice } from '@/lib/server/cartValidation'

type Row = Record<string, unknown>
function fakeDb(tables: Record<string, Row[] | Error>) {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = []
      const b: any = {
        select: () => b,
        in: (col: string, vals: unknown[]) => { filters.push(r => vals.map(String).includes(String(r[col]))); return b },
        eq: (col: string, v: unknown) => { filters.push(r => r[col] === v); return b },
        then: (res: (v: unknown) => unknown) => {
          const t = tables[table]
          if (t instanceof Error) return Promise.resolve({ data: null, error: { message: t.message } }).then(res)
          return Promise.resolve({ data: (t ?? []).filter(r => filters.every(f => f(r))), error: null }).then(res)
        },
      }
      return b
    },
  } as any
}

const product = (over: Row = {}) => ({ id: 1, name: 'Wild Honey', is_deleted: false, status: 'active', selling_price: 450, price: 999, mrp: 600, available_stock: 20, ...over })
const variant = (over: Row = {}) => ({ id: 11, product_id: 1, price: 500, original_price: 650, is_active: true, available_stock: 8, ...over })
const L = (productId: string, variantId: string, qty = 1) => ({ productId, variantId, qty })

describe('validateCartLines — variant lines', () => {
  it('ok line returns the LIVE variant price/mrp/stock and the product name', async () => {
    const [l] = await validateCartLines(fakeDb({ product_variants: [variant()], products: [product()] }), [L('1', '11', 2)])
    expect(l).toEqual({ productId: '1', variantId: '11', status: 'ok', name: 'Wild Honey', price: 500, mrp: 650, available: 8 })
  })

  it('stock below the requested qty → insufficient_stock with the available count', async () => {
    const [l] = await validateCartLines(fakeDb({ product_variants: [variant({ available_stock: 3 })], products: [product()] }), [L('1', '11', 5)])
    expect(l).toMatchObject({ status: 'insufficient_stock', available: 3 })
  })

  it.each([0, null])('stock %s → out_of_stock (NULL counts as 0, matching the reserve RPC)', async (stock) => {
    const [l] = await validateCartLines(fakeDb({ product_variants: [variant({ available_stock: stock })], products: [product()] }), [L('1', '11')])
    expect(l.status).toBe('out_of_stock')
    expect(l.available).toBe(0)
  })

  it.each([
    ['inactive variant',           { product_variants: [variant({ is_active: false })], products: [product()] }],
    ['variant row missing',        { product_variants: [], products: [product()] }],
    ['variant belongs to another product', { product_variants: [variant({ product_id: 2 })], products: [product(), product({ id: 2 })] }],
    ['product deleted',            { product_variants: [variant()], products: [product({ is_deleted: true })] }],
    ['product not active',         { product_variants: [variant()], products: [product({ status: 'draft' })] }],
  ])('%s → unavailable', async (_l, tables) => {
    const [l] = await validateCartLines(fakeDb(tables), [L('1', '11')])
    expect(l.status).toBe('unavailable')
    expect(l.price).toBe(0)
  })

  it('variant with no price falls back to the product selling_price (never the legacy price column)', async () => {
    const [l] = await validateCartLines(fakeDb({ product_variants: [variant({ price: 0, original_price: null })], products: [product()] }), [L('1', '11')])
    expect(l.price).toBe(450)
  })
})

describe('validateCartLines — no-variant lines (variantId === productId)', () => {
  it('product with NO active variants → priced from the products table, stock from the product', async () => {
    const [l] = await validateCartLines(fakeDb({ product_variants: [], products: [product({ available_stock: 4 })] }), [L('1', '1', 2)])
    expect(l).toMatchObject({ status: 'ok', price: 450, available: 4 })
  })

  it('I3: product that HAS active variants is unavailable as a no-variant line', async () => {
    const [l] = await validateCartLines(fakeDb({ product_variants: [variant()], products: [product()] }), [L('1', '1')])
    expect(l.status).toBe('unavailable')
  })

  it('only INACTIVE variants → still a valid no-variant product', async () => {
    const [l] = await validateCartLines(fakeDb({ product_variants: [variant({ is_active: false })], products: [product()] }), [L('1', '1')])
    expect(l.status).toBe('ok')
  })
})

describe('validateCartLines — misc', () => {
  it('returns one result per input line, in order', async () => {
    const lines = await validateCartLines(
      fakeDb({ product_variants: [variant(), variant({ id: 12, available_stock: 0 })], products: [product()] }),
      [L('1', '12'), L('1', '11')],
    )
    expect(lines.map(l => [l.variantId, l.status])).toEqual([['12', 'out_of_stock'], ['11', 'ok']])
  })

  it('throws (never guesses) when a lookup fails', async () => {
    await expect(validateCartLines(fakeDb({ product_variants: new Error('db down'), products: [] }), [L('1', '11')])).rejects.toThrow(/variants lookup failed/)
    await expect(validateCartLines(fakeDb({ product_variants: [variant()], products: new Error('db down') }), [L('1', '11')])).rejects.toThrow(/products lookup failed/)
  })
})

describe('shared pricing helpers (createOrder uses the same ones)', () => {
  it('productLinePrice prefers selling_price over legacy price', () => {
    expect(productLinePrice({ id: 1, selling_price: 800, price: 714.29 })).toBe(800)
    expect(productLinePrice({ id: 1, selling_price: null, price: 100 })).toBe(100)
    expect(productLinePrice(undefined)).toBe(0)
  })
  it('variantLinePrice prefers the variant price, then product selling_price', () => {
    expect(variantLinePrice({ id: 1, product_id: 1, price: 120 }, { id: 1, selling_price: 100 })).toBe(120)
    expect(variantLinePrice({ id: 1, product_id: 1, price: 0 },   { id: 1, selling_price: 100 })).toBe(100)
  })
})
