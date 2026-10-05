/**
 * lib/lineKinds.ts — decides whether a cart line is a real variant or a bare product.
 * Regression for the Oct 2026 audit: live product 1 (Manali Honey) owns variant 1, so
 * `variantId === productId` alone cannot mean "no variant".
 */
import { describe, it, expect } from 'vitest'
import { isAmbiguousLine, buildOwnerMap, resolveLine } from '@/lib/lineKinds'

describe('isAmbiguousLine', () => {
  it('is true only when the two ids are equal (compared as strings)', () => {
    expect(isAmbiguousLine({ productId: '1', variantId: '1' })).toBe(true)
    expect(isAmbiguousLine({ productId: '1', variantId: '11' })).toBe(false)
  })
})

describe('resolveLine', () => {
  const owners = buildOwnerMap([{ id: 1, product_id: 1 }, { id: 11, product_id: 14 }, { id: 14, product_id: 16 }])

  it('different ids are always a variant line (ownership is verified later by the caller)', () => {
    expect(resolveLine({ productId: '14', variantId: '11' }, owners)).toEqual({ kind: 'variant' })
  })

  it('equal ids + a variant with that id that belongs to the SAME product = a real variant (the honey case)', () => {
    expect(resolveLine({ productId: '1', variantId: '1' }, owners)).toEqual({ kind: 'variant' })
  })

  it('equal ids + no variant with that id = the no-variant convention', () => {
    expect(resolveLine({ productId: '99', variantId: '99' }, owners)).toEqual({ kind: 'product' })
  })

  it('equal ids + that variant belongs to ANOTHER product = a stale legacy line, never attached to it', () => {
    expect(resolveLine({ productId: '14', variantId: '14' }, owners)).toEqual({ kind: 'foreign_variant' })
  })

  it('numeric rows and string ids compare equal', () => {
    expect(buildOwnerMap([{ id: 5, product_id: 5 }]).get('5')).toBe('5')
  })

  it('tolerates null / empty lookups', () => {
    expect(buildOwnerMap(null).size).toBe(0)
    expect(resolveLine({ productId: '3', variantId: '3' }, buildOwnerMap(undefined))).toEqual({ kind: 'product' })
  })
})
