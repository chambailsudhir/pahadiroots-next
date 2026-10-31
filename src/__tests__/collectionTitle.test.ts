import { describe, it, expect } from 'vitest'
import { collectionTitle } from '@/lib/collectionTitle'

describe('collectionTitle (audit HOME-019)', () => {
  it('adds the Himalayan prefix to names that do not have it', () => {
    expect(collectionTitle('Shilajit')).toBe('Shilajit — Himalayan Shilajit')
    expect(collectionTitle('Herbs & Spices')).toBe('Herbs & Spices — Himalayan Herbs & Spices')
  })
  it('does not double the word for names that already start with Himalayan', () => {
    expect(collectionTitle('Himalayan Honey')).toBe('Himalayan Honey — Himalayan Honey')
    expect(collectionTitle('Himalayan Ghee')).toBe('Himalayan Ghee — Himalayan Ghee')
    expect(collectionTitle('himalayan tea')).toBe('himalayan tea — himalayan tea')
    expect(collectionTitle('Himalayan Honey')).not.toMatch(/Himalayan Himalayan/)
  })
  it('only treats Himalayan as a prefix when it is a whole word', () => {
    expect(collectionTitle('Himalayans Pride')).toBe('Himalayans Pride — Himalayan Himalayans Pride')
  })
  it('is safe for blank names', () => { expect(collectionTitle('  ')).toBe(' — Himalayan ') })
})
