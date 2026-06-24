/**
 * inventoryService.test.ts
 *
 * Direct unit tests for inventoryService.ts — specifically the restoreStock()
 * function, which had ZERO direct test coverage before this file, and
 * contained a real stock-leak bug:
 *
 * BUG FIX [ERROR HANDLING]: restoreStock() called db.rpc() with no try/catch
 * and no error-checking on the result. If any single item's restore RPC
 * failed (transient DB error, variant deleted since order time, connection
 * reset), the function threw immediately, leaving every SUBSEQUENT item in
 * the list permanently unreserved — a silent stock leak. Unlike the internal
 * _restoreReserved helper (which already had per-item try/catch), the public
 * restoreStock() had no protection at all.
 *
 * Fix: per-item try/catch that logs and continues, mirroring _restoreReserved.
 *
 * Covered here:
 *   1. Happy path — all items are restored (all RPCs attempted).
 *   2. BUG FIX — a mid-loop RPC failure does NOT prevent remaining items
 *      from being restored; the function never throws to the caller.
 *   3. ALL items failing — still doesn't throw, and still attempts every item.
 *   4. Empty items list — no RPC calls, no throw.
 *   5. Correct RPC name and arg shape for variant vs no-variant products.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Supabase mock ────────────────────────────────────────────────────────────

type RpcCall = { name: string; args: Record<string, unknown> }

interface RpcMockOptions {
  failOnIndices?: number[]
  failAll?: boolean
}

let rpcCalls: RpcCall[]

function makeSupabaseMock(opts: RpcMockOptions = {}) {
  rpcCalls = []
  let callIndex = 0
  return {
    from: () => ({}),
    rpc: (name: string, args: Record<string, unknown>) => {
      const idx = callIndex++
      rpcCalls.push({ name, args })
      if (opts.failAll || (opts.failOnIndices ?? []).includes(idx)) {
        return Promise.reject(new Error(`Simulated RPC failure on call ${idx}`))
      }
      return Promise.resolve({ data: true, error: null })
    },
  }
}

// vi.hoisted() runs before vi.mock() hoisting, so this value is available
// inside the factory below.
const { mockGetServiceClient } = vi.hoisted(() => ({
  mockGetServiceClient: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceClient: mockGetServiceClient,
  supabase: {},
}))

import { restoreStock, reserveStockAtomicForOrder, StockReservationError } from '@/lib/services/inventoryService'

beforeEach(() => {
  rpcCalls = []
})

function wireSupabaseMock(opts: RpcMockOptions = {}) {
  mockGetServiceClient.mockReturnValue(makeSupabaseMock(opts))
}

// ─────────────────────────────────────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────────────────────────────────────

describe('inventoryService.restoreStock — happy path', () => {
  it('calls restore_stock RPC for each variant item', async () => {
    wireSupabaseMock()


    await restoreStock([
      { variantId: 'v1', qty: 2 },
      { variantId: 'v2', qty: 1 },
    ])

    expect(rpcCalls).toHaveLength(2)
    expect(rpcCalls[0]).toEqual({ name: 'restore_stock', args: { p_variant_id: 'v1', p_qty: 2 } })
    expect(rpcCalls[1]).toEqual({ name: 'restore_stock', args: { p_variant_id: 'v2', p_qty: 1 } })
  })

  it('calls restore_product_stock RPC for no-variant products (variantId === productId)', async () => {
    wireSupabaseMock()


    await restoreStock([
      { variantId: 'p1', productId: 'p1', qty: 3 },
    ])

    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0]).toEqual({ name: 'restore_product_stock', args: { p_product_id: 'p1', p_qty: 3 } })
  })

  it('is a no-op when items is empty — no RPC calls made', async () => {
    wireSupabaseMock()


    await expect(restoreStock([])).resolves.toBeUndefined()
    expect(rpcCalls).toHaveLength(0)
  })

  it('resolves to void (not the RPC result) on success', async () => {
    wireSupabaseMock()


    const result = await restoreStock([{ variantId: 'v1', qty: 1 }])
    expect(result).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BUG FIX — per-item error isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('inventoryService.restoreStock — per-item error isolation (BUG FIX)', () => {
  it('continues restoring remaining items when a mid-loop RPC throws', async () => {
    wireSupabaseMock({ failOnIndices: [1] }) // second item fails


    // BEFORE the fix: this would throw at item [1] and item [2] was never
    // restored — a permanent, silent stock leak.
    // AFTER the fix: catches item [1]'s error, logs it, and continues to item [2].
    await expect(restoreStock([
      { variantId: 'v1', qty: 2 },   // succeeds
      { variantId: 'v2', qty: 1 },   // ← throws
      { variantId: 'v3', qty: 3 },   // ← must still run after the fix
    ])).resolves.toBeUndefined()   // never re-throws to the caller

    // All 3 RPCs must have been attempted
    expect(rpcCalls).toHaveLength(3)
    expect(rpcCalls[2].args.p_variant_id).toBe('v3')
  })

  it('restores all items even when the FIRST item fails', async () => {
    wireSupabaseMock({ failOnIndices: [0] })


    await expect(restoreStock([
      { variantId: 'v1', qty: 1 },   // ← throws
      { variantId: 'v2', qty: 1 },   // ← must still run
    ])).resolves.toBeUndefined()

    expect(rpcCalls).toHaveLength(2)
    expect(rpcCalls[1].args.p_variant_id).toBe('v2')
  })

  it('does not throw even when ALL items fail', async () => {
    wireSupabaseMock({ failAll: true })


    await expect(restoreStock([
      { variantId: 'v1', qty: 1 },
      { variantId: 'v2', qty: 1 },
      { variantId: 'v3', qty: 1 },
    ])).resolves.toBeUndefined()

    // All 3 were attempted despite each failing
    expect(rpcCalls).toHaveLength(3)
  })

  it('handles a mix of variant and no-variant items with mid-loop failure', async () => {
    wireSupabaseMock({ failOnIndices: [1] }) // the product-restore fails


    await expect(restoreStock([
      { variantId: 'v1', qty: 2 },              // variant — succeeds
      { variantId: 'p1', productId: 'p1', qty: 1 }, // no-variant — throws
      { variantId: 'v2', qty: 1 },              // variant — must still run
    ])).resolves.toBeUndefined()

    expect(rpcCalls).toHaveLength(3)
    expect(rpcCalls[0].name).toBe('restore_stock')
    expect(rpcCalls[1].name).toBe('restore_product_stock')
    expect(rpcCalls[2].name).toBe('restore_stock')
    expect(rpcCalls[2].args.p_variant_id).toBe('v2')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// reserveStockAtomicForOrder — infra failure vs. genuine stock shortfall
// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION TEST for the production incident where reserve_stock_at_order's
// SQL parameter was declared UUID while product_variants.id is actually
// BIGINT. Every call errored with Postgres code 22P02 (invalid_text_representation),
// and the old code treated *any* RPC error identically to a real
// "available_stock < qty" result — surfacing "Insufficient stock" to paying
// customers even when stock was plentiful.
//
// These tests pin the fix: a DB/RPC *error* must throw StockReservationError
// (→ 500, alerted, never shown to the customer as a stock message), while a
// clean `{ data: false, error: null }` response — the RPC explicitly telling
// us the WHERE guard didn't match — must still produce the ordinary
// { ok: false } business-logic result.
describe('reserveStockAtomicForOrder — infra error vs. real stock shortfall', () => {
  function wireRpcMock(responses: Array<{ data?: unknown; error?: unknown }>) {
    rpcCalls = []
    let i = 0
    mockGetServiceClient.mockReturnValue({
      from: () => ({}),
      rpc: (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args })
        const resp = responses[Math.min(i, responses.length - 1)]
        i++
        return Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null })
      },
    })
  }

  it('throws StockReservationError when the DB errors with a type-mismatch code (22P02) — NOT a stock message', async () => {
    wireRpcMock([{ data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid: "13"' } }])

    await expect(
      reserveStockAtomicForOrder([{ variantId: '13', qty: 1 }])
    ).rejects.toBeInstanceOf(StockReservationError)
  })

  it('returns { ok: false } (real shortfall) when the RPC cleanly reports data: false with no error', async () => {
    wireRpcMock([{ data: false, error: null }])

    const result = await reserveStockAtomicForOrder([{ variantId: 'v1', qty: 99 }])

    expect(result).toEqual({ ok: false, failedVariantId: 'v1' })
  })

  it('returns { ok: true } and reserves all items when every RPC call succeeds', async () => {
    wireRpcMock([{ data: true, error: null }, { data: true, error: null }])

    const result = await reserveStockAtomicForOrder([
      { variantId: 'v1', qty: 1 },
      { variantId: 'v2', qty: 2 },
    ])

    expect(result).toEqual({ ok: true })
    expect(rpcCalls).toHaveLength(2)
  })

  it('rolls back already-reserved items before throwing on a later infra error', async () => {
    wireRpcMock([
      { data: true, error: null },                                 // v1 reserves fine
      { data: null, error: { code: '22P02', message: 'bad uuid' } }, // v2 errors
    ])

    await expect(
      reserveStockAtomicForOrder([
        { variantId: 'v1', qty: 1 },
        { variantId: 'v2', qty: 1 },
      ])
    ).rejects.toBeInstanceOf(StockReservationError)

    // 2 forward calls (v1 reserve, v2 reserve-fails) + 1 rollback call for v1
    expect(rpcCalls).toHaveLength(3)
    expect(rpcCalls[2].name).toBe('restore_stock')
    expect(rpcCalls[2].args.p_variant_id).toBe('v1')
  })
})
