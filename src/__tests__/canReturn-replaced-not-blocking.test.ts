// ── canReturn-replaced-not-blocking.test.ts ─────────────────────────────────
// Regression test for the Aug 18 audit fix: canReturn() (useOrders.ts)
// treated 'replaced' as a still-in-progress return status, blocking a new
// return forever, even though it's exactly as terminal/resolved as
// 'refunded' (which was already correctly excluded). A customer whose
// replacement unit later arrived damaged too could never get the Return
// button back for that order. Matches the identical fix made the same day
// in admin's three duplicate-check exclusion lists and the storefront's
// /api/orders/[id]/return/route.ts idempotency check.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi } from 'vitest'

// canReturn() is a pure function of its Order argument + a module-level
// constant, but it lives in useOrders.ts, which transitively imports
// orderService.ts -> lib/supabase.ts (a real Supabase client constructed at
// module-load time, requiring env vars this test environment doesn't set).
// Mock it out the same way orderService.createOrder.test.ts does — canReturn
// itself never touches the client, so an empty stub is enough.
vi.mock('@/lib/supabase', () => ({
  getServiceClient: () => ({ from: () => ({}), rpc: () => Promise.resolve({ data: null, error: null }) }),
  supabase: {},
}))

import { canReturn } from '@/app/account/hooks/useOrders'
import { type Order } from '@/lib/services/orderService'

function makeOrder(overrides: Partial<Order> & { _return?: { status?: string } | null }): Order {
  return {
    id: 'o1',
    order_number: 'PR-1001',
    order_status: 'delivered',
    delivered_at: new Date().toISOString(), // just delivered — well within the return window
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  } as unknown as Order
}

describe('canReturn — replaced is terminal, not blocking (Aug 18 fix)', () => {
  it('allows a new return when the existing return is replaced', () => {
    const order = makeOrder({ _return: { status: 'replaced' } })
    expect(canReturn(order)).toBe(true)
  })

  it('still allows a new return when the existing return is refunded (unchanged behavior)', () => {
    const order = makeOrder({ _return: { status: 'refunded' } })
    expect(canReturn(order)).toBe(true)
  })

  it('still allows a new return when the existing return is rejected (unchanged behavior)', () => {
    const order = makeOrder({ _return: { status: 'rejected' } })
    expect(canReturn(order)).toBe(true)
  })

  it('still blocks a new return while one is genuinely in progress', () => {
    for (const status of ['requested', 'approved', 'received']) {
      const order = makeOrder({ _return: { status } })
      expect(canReturn(order)).toBe(false)
    }
  })

  it('still blocks when the order itself is not delivered', () => {
    const order = makeOrder({ order_status: 'shipped', _return: null })
    expect(canReturn(order)).toBe(false)
  })
})
