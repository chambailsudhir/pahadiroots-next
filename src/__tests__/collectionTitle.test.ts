import { describe, it, expect } from 'vitest'
import { collectionTitle } from '@/lib/collectionTitle'

const TAIL = ' — Farm-Direct from the Himalayas'
describe('collectionTitle (audit HOME-019)', () => {
  it('adds the Himalayan prefix to names that do not have it', () => {
    expect(collectionTitle('Shilajit')).toBe('Himalayan Shilajit' + TAIL)
    expect(collectionTitle('Herbs & Spices')).toBe('Himalayan Herbs & Spices' + TAIL)
  })
  it('never repeats the category name or the word Himalayan', () => {
    expect(collectionTitle('Himalayan Honey')).toBe('Himalayan Honey' + TAIL)
    expect(collectionTitle('himalayan tea')).toBe('himalayan tea' + TAIL)
    expect(collectionTitle('Himalayan Honey')).not.toMatch(/Himalayan Himalayan|Honey — Himalayan Honey/)
  })
  it('only treats Himalayan as a prefix when it is a whole word', () => {
    expect(collectionTitle('Himalayans Pride')).toBe('Himalayan Himalayans Pride' + TAIL)
  })
  it('is safe for blank names', () => { expect(collectionTitle('  ')).toBe('Himalayan Collection' + TAIL) })
})
