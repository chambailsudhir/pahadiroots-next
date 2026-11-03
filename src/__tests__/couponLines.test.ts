import { describe, it, expect } from 'vitest'
import { couponLines } from '@/lib/couponLines'
describe('couponLines', () => {
  it('keeps paise (the server prices lines unrounded), never negative', () => {
    expect(couponLines([{ productId: 1, price: 266.67, qty: 3 }, { productId: 2, price: -5, qty: 1 }])).toEqual([
      { productId: 1, amount: 800.01 }, { productId: 2, amount: 0 },
    ])
  })
})
