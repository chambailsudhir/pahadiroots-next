/** PS1 — product/variant ids are interpolated into PostgREST filters, so the schema must only admit plain identifiers. */
import { describe, it, expect } from 'vitest'
import { orderItemSchema } from '@/lib/schemas'

describe('orderItemSchema ids', () => {
  it.each(['13', 'var-uuid-1', '123e4567-e89b-12d3-a456-426614174000', 'a_b-C9'])('accepts %s', (id) => {
    expect(orderItemSchema.safeParse({ productId: id, variantId: id, qty: 1 }).success).toBe(true)
  })
  it.each(['', ' ', '1,2', '1)', 'a.b', "x'y", '1),or=(id.gt.0', 'a b', 'x'.repeat(65)])('rejects %j', (id) => {
    expect(orderItemSchema.safeParse({ productId: id, variantId: '1', qty: 1 }).success).toBe(false)
    expect(orderItemSchema.safeParse({ productId: '1', variantId: id, qty: 1 }).success).toBe(false)
  })
})
