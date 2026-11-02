import { describe, it, expect } from 'vitest'
import { sameDeliveryAddress, addressTokens } from '@/lib/addressMatch'

const A = { pincode: '176082', line: '12 Main Road, Near Hospital' }

describe('sameDeliveryAddress — the same place, typed differently', () => {
  it.each([
    '12 Main Road, Near Hospital',
    '  12  MAIN ROAD,, near hospital  ',
    'Flat No. 12, Main Rd',
    'House no 12 main road',
    '12, Main Road',
  ])('matches %j', (line) => { expect(sameDeliveryAddress(A, { pincode: '176082', line })).toBe(true) })

  it.each([
    ['a different PIN',                { pincode: '176001', line: '12 Main Road, Near Hospital' }],
    ['a neighbour (other house number)',{ pincode: '176082', line: '14 Main Road, Near Hospital' }],
    ['a different street, same number', { pincode: '176082', line: '12 Temple Street, Bazaar' }],
    ['a different flat in the same block', { pincode: '176082', line: 'Flat 4B, Green Valley Apartments' }],
  ])('does NOT match %s', (_n, other) => { expect(sameDeliveryAddress(A, other)).toBe(false) })

  it('flat numbers: 4B vs 4C are different homes, 4B vs "flat 4b" the same', () => {
    const g = (line: string) => ({ pincode: '110001', line })
    expect(sameDeliveryAddress(g('Flat 4B, Green Valley Apartments'), g('4C Green Valley Apartments'))).toBe(false)
    expect(sameDeliveryAddress(g('Flat 4B, Green Valley Apartments'), g('flat 4b green valley apartment'))).toBe(true)
  })

  it('needs something to compare: one-word / empty addresses never match, nor does a missing PIN', () => {
    expect(sameDeliveryAddress({ pincode: '176082', line: 'Home' }, { pincode: '176082', line: 'Home' })).toBe(false)
    expect(sameDeliveryAddress({ pincode: '176082', line: '' }, { pincode: '176082', line: '' })).toBe(false)
    expect(sameDeliveryAddress({ pincode: '', line: A.line }, { pincode: '', line: A.line })).toBe(false)
    expect(sameDeliveryAddress({ pincode: null, line: A.line }, A)).toBe(false)
  })

  it('rural addresses without numbers still match on the words (village / post office / district are noise)', () => {
    const a = { pincode: '176082', line: 'Village Sakoh, PO Sakoh, Distt Kangra' }
    expect(sameDeliveryAddress(a, { pincode: '176082', line: 'Sakoh village, Kangra' })).toBe(true)
  })

  it('tokens: lower-cased, punctuation stripped, abbreviations expanded, filler removed, de-duplicated', () => {
    expect(addressTokens('Flat No. 12, Main Rd & Main Road')).toEqual(['12', 'main', 'road'])
  })
})
