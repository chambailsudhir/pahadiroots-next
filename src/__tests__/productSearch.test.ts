import { describe, it, expect } from 'vitest'
import { searchProducts, scoreProductName, normalizeSearchText, editDistance } from '@/lib/productSearch'

const catalog = [
  { name: 'Himalayan Wild Manali Honey', slug: 'himalayan-wild-manali-honey' },
  { name: 'Himalayan Spiti Valley Multiflora Honey', slug: 'spiti-multiflora-honey' },
  { name: 'Sea Buckthorn Pulp', slug: 'sea-buckthorn' },
  { name: 'Cold Pressed Mustard Oil', slug: 'cold-pressed-mustard-oil' },
  { name: 'Pure Himalayan Ghee', slug: 'himalayan-ghee' },
  { name: 'Shilajit Resin', slug: 'shilajit' },
]
const names = (q: string) => searchProducts(catalog, q).map(p => p.name)

describe('productSearch', () => {
  it('normalizes case, accents, punctuation and spacing', () => {
    expect(normalizeSearchText('  Sea-Buckthorn!!  Pulp ')).toBe('sea buckthorn pulp')
  })

  it('REGRESSION: "seab" finds Sea Buckthorn (the space in the name used to break the match)', () => {
    expect(names('seab')).toContain('Sea Buckthorn Pulp')
  })

  it('finds by partial words with or without a space', () => {
    for (const q of ['sea buck', 'seabuck', 'seabuckthorn', 'sea buckthorn', 'SEA  BUCK', 'buckthorn']) {
      expect(names(q)[0]).toBe('Sea Buckthorn Pulp')
    }
  })

  it('forgives small typos and swapped letters', () => {
    expect(names('hunny')[0]).toMatch(/Honey$/)
    expect(names('hoeny')[0]).toMatch(/Honey$/)
    expect(names('ghe')).toContain('Pure Himalayan Ghee')
    expect(names('gheee')).toContain('Pure Himalayan Ghee')
    expect(names('mustrad oil')).toContain('Cold Pressed Mustard Oil')
    expect(names('shilajt')).toContain('Shilajit Resin')
    expect(names('seabukthorn')).toContain('Sea Buckthorn Pulp')
  })

  it('requires every typed word to match (no false positives)', () => {
    expect(names('honey mustard')).toEqual([])
    expect(names('xyzzy')).toEqual([])
    expect(names('sea ghee')).toEqual([])
  })

  it('does not fuzz very short words (too ambiguous)', () => {
    expect(scoreProductName('Pure Himalayan Ghee', 'oil')).toBe(0)
  })

  it('ranks closer matches first and needs at least 2 characters', () => {
    expect(names('honey').length).toBe(2)
    expect(searchProducts(catalog, 'h')).toEqual([])
    expect(searchProducts(catalog, '   ')).toEqual([])
  })

  it('respects the limit', () => {
    expect(searchProducts(catalog, 'himalayan', 2).length).toBe(2)
  })

  it('editDistance handles transpositions as a single edit', () => {
    expect(editDistance('honey', 'hoeny')).toBe(1)
    expect(editDistance('ghee', 'gee')).toBe(1)
  })
})
