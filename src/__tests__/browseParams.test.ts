import { describe, it, expect } from 'vitest'
import { parsePage, parsePrice, parseSort, firstParam, parseBrowseParams } from '@/lib/browseParams'
import { buildProductsUrl } from '@/lib/buildProductsUrl'

describe('parsePage', () => {
  it('defaults to 1 for missing/garbage/zero/negative input (never NaN)', () => {
    for (const v of [undefined, '', 'abc', '0', '-3', 'NaN', 'Infinity']) {
      expect(parsePage(v)).toBe(1)
    }
  })
  it('parses valid integers and takes the first of repeated params', () => {
    expect(parsePage('4')).toBe(4)
    expect(parsePage(['2', '9'])).toBe(2)
  })
})

describe('parsePrice', () => {
  it('drops invalid values instead of returning NaN', () => {
    for (const v of [undefined, '', '  ', 'abc', 'NaN', 'Infinity', '-5']) {
      expect(parsePrice(v)).toBeUndefined()
    }
  })
  it('keeps valid numbers including 0', () => {
    expect(parsePrice('250')).toBe(250)
    expect(parsePrice('0')).toBe(0)
    expect(parsePrice(['300', '999'])).toBe(300)
  })
})

describe('parseSort / firstParam', () => {
  it('falls back to newest for unknown sort values', () => {
    expect(parseSort('bogus')).toBe('newest')
    expect(parseSort(undefined)).toBe('newest')
    expect(parseSort('price_asc')).toBe('price_asc')
  })
  it('firstParam unwraps arrays', () => {
    expect(firstParam(['a', 'b'])).toBe('a')
    expect(firstParam('x')).toBe('x')
  })
})

describe('parseBrowseParams', () => {
  it('swaps an inverted price range', () => {
    const r = parseBrowseParams({ minPrice: '500', maxPrice: '300' })
    expect(r.minPrice).toBe(300)
    expect(r.maxPrice).toBe(500)
  })
  it('only treats instock=true as on', () => {
    expect(parseBrowseParams({ instock: 'true' }).instock).toBe(true)
    expect(parseBrowseParams({ instock: 'false' }).instock).toBe(false)
    expect(parseBrowseParams({ instock: ['true', 'false'] }).instock).toBe(true)
  })
  it('a fully broken query string yields safe defaults', () => {
    const r = parseBrowseParams({ page: 'abc', minPrice: 'x', maxPrice: 'y', sort: '??' })
    expect(r).toMatchObject({ page: 1, sort: 'newest', instock: false, category: '', state: '' })
    expect(r.minPrice).toBeUndefined()
    expect(r.maxPrice).toBeUndefined()
  })
})

describe('buildProductsUrl hygiene (Issue 6.4 / 6.5)', () => {
  const base = { sort: 'newest', category: 'honey', state: '', instock: true, minPrice: '500', maxPrice: '900' }

  it('never emits instock=false', () => {
    const url = buildProductsUrl(base, { instock: 'false' })
    expect(url).not.toContain('instock')
  })
  it('still emits instock=true', () => {
    expect(buildProductsUrl({ ...base, instock: false }, { instock: 'true' })).toContain('instock=true')
  })
  it('drops the price range when the category changes', () => {
    const url = buildProductsUrl(base, { category: 'ghee' })
    expect(url).toContain('category=ghee')
    expect(url).not.toContain('minPrice')
    expect(url).not.toContain('maxPrice')
  })
  it('drops the price range when the state changes', () => {
    const url = buildProductsUrl(base, { state: '7' })
    expect(url).not.toContain('Price')
  })
  it('keeps the price range for unrelated changes (sort, page, same category)', () => {
    expect(buildProductsUrl(base, { sort: 'price_asc' })).toContain('minPrice=500')
    expect(buildProductsUrl(base, { page: '2' })).toContain('maxPrice=900')
    expect(buildProductsUrl(base, { category: 'honey' })).toContain('minPrice=500')
  })
  it('an explicit price override on a category change is respected', () => {
    const url = buildProductsUrl(base, { category: 'ghee', minPrice: '100' })
    expect(url).toContain('minPrice=100')
    expect(url).not.toContain('maxPrice')
  })
})
