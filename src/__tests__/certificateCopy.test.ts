import { describe, it, expect } from 'vitest'
import { certifiedParameters, joinParameters } from '@/lib/certificateCopy'

const all = { hasPurity: true, hasHeavyMetals: true, hasPesticides: true, hasActiveIngredients: true }
describe('certifiedParameters', () => {
  it('lists exactly what is ticked, in the card order', () => {
    expect(certifiedParameters(all)).toEqual(['purity', 'heavy metals', 'pesticides', 'active ingredients'])
    expect(certifiedParameters({ ...all, hasPesticides: false, hasActiveIngredients: false })).toEqual(['purity', 'heavy metals'])
  })
  it('is empty when no certificate / nothing ticked — so no lab claim can be rendered', () => {
    expect(certifiedParameters(null)).toEqual([])
    expect(certifiedParameters(undefined)).toEqual([])
    expect(certifiedParameters({ hasPurity: false, hasHeavyMetals: false, hasPesticides: false, hasActiveIngredients: false })).toEqual([])
  })
})
describe('joinParameters', () => {
  it('joins naturally', () => {
    expect(joinParameters([])).toBe('')
    expect(joinParameters(['purity'])).toBe('purity')
    expect(joinParameters(['purity', 'heavy metals'])).toBe('purity & heavy metals')
    expect(joinParameters(['purity', 'heavy metals', 'pesticides'])).toBe('purity, heavy metals & pesticides')
  })
})
