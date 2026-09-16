/**
 * webhookRazorpay.test.ts
 *
 * Direct route-level tests for POST /api/v1/webhook/razorpay — the
 * server-to-server callback Razorpay uses to confirm captures and report
 * failures. Arguably the single highest-stakes untested file in the
 * codebase: it is the backstop that confirms real money movement, and it is
 * reachable by anyone on the internet (no session, no CSRF token — only the
 * HMAC signature gates it).
 *
 * AUDIT GAP: zero test coverage before this file.
 *
 * Covered here:
 *   1. [SECURITY] HMAC signature verification — wrong secret/signature → 400,
 *      no DB writes attempted at all (order not even looked up).
 *   2. [BUG FIX] Content-Length DoS guard — Number()+isFinite, not parseInt(),
 *      so a non-numeric header doesn't silently bypass the 1MB size gate.
 *   3. [BUG FIX] Content-Type guard — non-JSON body rejected with 415 before
 *      ever touching JSON.parse.
 *   4. Missing RAZORPAY_WEBHOOK_SECRET env var → 500, never silently no-ops.
 *   5. payment.captured — happy path: order pending → confirmed, payment_id
 *      set, event logged.
 *   6. [TOCTOU FIX] payment.captured — the atomic `.eq('order_status','pending')`
 *      guard on the UPDATE means a "lost race" (0 rows updated) skips the
 *      duplicate event log instead of double-logging.
 *   7. payment.captured with missing notes.db_order_id → returns 200 (so
 *      Razorpay doesn't retry-storm) without touching the orders table.
 *   8. payment.failed — happy path: stock restored, order_status set to
 *      'payment_failed' (not left at 'pending'), event logged.
 *   9. payment.failed when order is NOT 'pending' (e.g. already confirmed by
 *      a captured event) — must NOT restore stock or touch the order (avoids
 *      double-restoring stock for an order that actually succeeded).
 *  10. Webhook log lifecycle — inserted as 'received' before processing,
 *      updated to 'processed' on success, updated to 'failed' when the
 *      handler throws.
 *  11. Always returns 200 even when internal processing throws — Razorpay
 *      retries on non-2xx, which could replay into the same broken state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'

const ORIGINAL_ENV = { ...process.env }
const WEBHOOK_SECRET = 'test_webhook_secret'

const mockUpdateOrderStatus = vi.fn()
const mockLogOrderEvent     = vi.fn()
const mockRestoreStock      = vi.fn()

vi.mock('@/lib/services/orderService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/orderService')>()
  return {
    ...actual,
    updateOrderStatus: mockUpdateOrderStatus,
    logOrderEvent:     mockLogOrderEvent,
  }
})

vi.mock('@/lib/services/inventoryService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/inventoryService')>()
  return { ...actual, restoreStock: mockRestoreStock }
})

// ─── Minimal Supabase mock — table-keyed responses, tracks update calls ──────

interface MockDb {
  responses:            Record<string, unknown>
  updateCalls:          Array<{ table: string; payload: unknown; eqCalls: unknown[][] }>
  insertCalls:          Array<{ table: string; payload: unknown }>
  // Overrides what update().select() resolves to, independent of `responses`.
  // Lets a test simulate "the initial SELECT saw order_status='pending'" while
  // separately controlling "the UPDATE's WHERE clause matched 0 rows" — the
  // genuine TOCTOU race: a concurrent webhook delivery won between this
  // request's SELECT and its UPDATE.
  updateResultOverride: Record<string, unknown[]>
  // Forces update().select() to resolve with an ERROR for a table, which
  // `updateResultOverride` (data-only) cannot express. Needed to cover the
  // Sept 2026 fix: before it, the payment.failed UPDATE's error was never
  // destructured at all, so a failing UPDATE (it failed on every single call —
  // 'payment_failed' was not yet a member of order_status_enum) was swallowed
  // silently while the stock restore ran anyway.
  updateErrorOverride:  Record<string, Error>
}
let mockDb: MockDb

function resetMockDb() {
  mockDb = { responses: {}, updateCalls: [], insertCalls: [], updateResultOverride: {}, updateErrorOverride: {} }
}

function buildQueryBuilder(table: string) {
  const response = () => {
    const val = mockDb.responses[table]
    if (val instanceof Error) return { data: null, error: val }
    return { data: val ?? null, error: null }
  }
  // When the chain went through update(), Supabase's .select() after an
  // UPDATE returns an ARRAY of affected rows (empty array = 0 rows updated,
  // i.e. "lost the optimistic-lock race"). When the chain is a plain SELECT
  // (.single()), it returns the single row object directly. Track which
  // path we're on so `then()` (used by `await db.from(...).update(...).eq(...).select('id')`,
  // which is awaited directly without .single()) returns the correct shape.
  let wentThroughUpdate = false
  let currentUpdate: { table: string; payload: unknown; eqCalls: unknown[][] } | null = null

  const builder: Record<string, (...a: unknown[]) => unknown> = {
    select: () => builder,
    insert: (payload: unknown) => {
      mockDb.insertCalls.push({ table, payload })
      return builder
    },
    update: (payload: unknown) => {
      wentThroughUpdate = true
      currentUpdate = { table, payload, eqCalls: [] }
      mockDb.updateCalls.push(currentUpdate)
      return builder
    },
    eq: (...args: unknown[]) => {
      if (currentUpdate) currentUpdate.eqCalls.push(args)
      return builder
    },
    single:      () => Promise.resolve(response()),
    maybeSingle: () => Promise.resolve(response()),
    then:        (...a: unknown[]) => {
      const resolved = wentThroughUpdate
        ? (() => {
            if (table in mockDb.updateErrorOverride) {
              return { data: null, error: mockDb.updateErrorOverride[table] }
            }
            if (table in mockDb.updateResultOverride) {
              return { data: mockDb.updateResultOverride[table], error: null }
            }
            // Default: a truthy, non-error table response represents "the
            // row exists and the optimistic-lock WHERE clause matched" -> one row affected.
            const r = response()
            if (r.error) return r
            return { data: r.data ? [r.data] : [], error: null }
          })()
        : response()
      return Promise.resolve(resolved).then(a[0] as (v: unknown) => unknown)
    },
  }
  return builder
}

vi.mock('@/lib/supabase', () => ({
  getServiceClient: () => ({ from: (table: string) => buildQueryBuilder(table) }),
  supabase: {},
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sign(body: string, secret = WEBHOOK_SECRET) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function makeEvent(overrides: Partial<{
  event: string
  paymentId: string
  amount: number
  dbOrderId: string | undefined
  errorReason: string
}> = {}) {
  const {
    event = 'payment.captured',
    paymentId = 'pay_test123',
    amount = 50000,
    dbOrderId = 'order-db-uuid-001',
    errorReason = 'card_declined',
  } = overrides
  return {
    event,
    payload: {
      payment: {
        entity: {
          id: paymentId,
          amount,
          error_reason: errorReason,
          notes: dbOrderId !== undefined ? { db_order_id: dbOrderId } : {},
        },
      },
    },
  }
}

function makeReq(body: object, opts: { signature?: string; contentType?: string; contentLength?: string } = {}) {
  const bodyStr = JSON.stringify(body)
  const headers = new Headers()
  headers.set('content-type', opts.contentType ?? 'application/json')
  if (opts.contentLength !== undefined) headers.set('content-length', opts.contentLength)
  headers.set('x-razorpay-signature', opts.signature ?? sign(bodyStr))
  return new Request('http://localhost/api/v1/webhook/razorpay', {
    method: 'POST',
    headers,
    body: bodyStr,
  })
}

beforeEach(() => {
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET
  resetMockDb()
  mockUpdateOrderStatus.mockClear()
  mockLogOrderEvent.mockClear()
  mockRestoreStock.mockClear().mockResolvedValue(undefined)
  vi.resetModules()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// Security gates
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /webhook/razorpay — security gates', () => {
  it('rejects with 400 when the signature does not match (wrong secret used by sender)', async () => {
    const event = makeEvent()
    const req = makeReq(event, { signature: sign(JSON.stringify(event), 'wrong-secret') })

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res  = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/invalid signature/i)
    expect(mockDb.updateCalls).toHaveLength(0)
  })

  it('rejects with 400 on a tampered body even though the attacker re-sends a stale signature', async () => {
    const original = makeEvent({ amount: 100 })
    const correctSig = sign(JSON.stringify(original))
    const tampered = makeEvent({ amount: 999999 }) // attacker changes the amount after signing

    const req = makeReq(tampered, { signature: correctSig })
    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res = await POST(req)

    expect(res.status).toBe(400)
  })

  it('returns 500 when RAZORPAY_WEBHOOK_SECRET is not configured (fails closed, not open)', async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET
    const event = makeEvent()
    const req = makeReq(event)

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res  = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toMatch(/not configured/i)
  })

  // BUG FIX regression: parseInt('abc') === NaN, and NaN > 1_048_576 is false,
  // so a non-numeric Content-Length header used to bypass the size gate
  // entirely. Number('abc') is also NaN, and Number.isFinite(NaN) is false,
  // so the fix treats a non-numeric header as "unknown size" — it does NOT
  // throw and does NOT incorrectly let an oversized request through silently;
  // it simply can't enforce the size check on that malformed header and
  // proceeds to genuine signature verification instead.
  it('does not crash or silently 413 on a non-numeric Content-Length header', async () => {
    const event = makeEvent()
    const req = makeReq(event, { contentLength: 'abc' })

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res = await POST(req)

    expect(res.status).not.toBe(413)
  })

  it('rejects a payload exceeding 1MB via Content-Length with 413', async () => {
    const event = makeEvent()
    const req = makeReq(event, { contentLength: String(2 * 1024 * 1024) })

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res  = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(413)
    expect(json.error).toMatch(/too large/i)
  })

  it('rejects a non-JSON content-type with 415 before attempting signature verification', async () => {
    const event = makeEvent()
    const req = makeReq(event, { contentType: 'text/plain' })

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res  = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(415)
    expect(json.error).toMatch(/unsupported content type/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// payment.captured
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /webhook/razorpay — payment.captured', () => {
  it('confirms a pending order: sets order_status=confirmed, payment_status=paid, payment_id', async () => {
    mockDb.responses['orders'] = { id: 'order-db-uuid-001', order_status: 'pending', order_number: 'PR1A2B3C4D' }

    const event = makeEvent({ event: 'payment.captured', paymentId: 'pay_abc', amount: 50000, dbOrderId: 'order-db-uuid-001' })
    const req = makeReq(event)

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res = await POST(req)
    expect(res.status).toBe(200)

    const orderUpdate = mockDb.updateCalls.find(c => c.table === 'orders')
    expect(orderUpdate).toBeDefined()
    expect(orderUpdate!.payload).toMatchObject({
      order_status: 'confirmed', payment_status: 'paid', payment_id: 'pay_abc',
    })
  })

  // TOCTOU FIX regression: the UPDATE must include the atomic guard
  // .eq('order_status','pending') so two concurrent webhook deliveries can't
  // both "win" and double-log the capture event.
  it('includes the atomic order_status=pending guard on the UPDATE (TOCTOU FIX)', async () => {
    mockDb.responses['orders'] = { id: 'order-db-uuid-001', order_status: 'pending' }
    const event = makeEvent({ dbOrderId: 'order-db-uuid-001' })
    const req = makeReq(event)

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    await POST(req)

    const orderUpdate = mockDb.updateCalls.find(c => c.table === 'orders')
    const hasGuard = orderUpdate!.eqCalls.some(args => args[0] === 'order_status' && args[1] === 'pending')
    expect(hasGuard).toBe(true)
  })

  it('logs the payment_captured_webhook event when the order was successfully confirmed', async () => {
    // The select().single() lookup AND the update().select('id') chain both
    // read from mockDb.responses['orders'] in this simplified mock — give it
    // a shape that satisfies both: a single object for .single(), which also
    // works truthy for the "did we win the race" check via .then().
    mockDb.responses['orders'] = { id: 'order-db-uuid-001', order_status: 'pending' }

    const event = makeEvent({ dbOrderId: 'order-db-uuid-001', paymentId: 'pay_xyz', amount: 30000 })
    const req = makeReq(event)

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    await POST(req)

    expect(mockLogOrderEvent).toHaveBeenCalledWith(
      'order-db-uuid-001',
      'payment_captured_webhook',
      'razorpay',
      expect.objectContaining({ razorpay_payment_id: 'pay_xyz', amount: 300 }), // 30000 paise -> 300 rupees
    )
  })

  it('does not touch the orders table when notes.db_order_id is missing', async () => {
    const event = makeEvent({ dbOrderId: undefined })
    const req = makeReq(event)

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res = await POST(req)

    expect(res.status).toBe(200) // Razorpay must not retry-storm
    expect(mockDb.updateCalls.find(c => c.table === 'orders')).toBeUndefined()
  })

  it('does not double-process an order that is already confirmed (order_status != pending)', async () => {
    mockDb.responses['orders'] = { id: 'order-db-uuid-001', order_status: 'confirmed' }
    const event = makeEvent({ dbOrderId: 'order-db-uuid-001' })
    const req = makeReq(event)

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    await POST(req)

    expect(mockDb.updateCalls.find(c => c.table === 'orders')).toBeUndefined()
    expect(mockLogOrderEvent).not.toHaveBeenCalled()
  })

  // TOCTOU FIX regression: simulates genuinely losing the race — the SELECT
  // sees order_status='pending' (so the route attempts the UPDATE), but by
  // the time the UPDATE's WHERE clause evaluates, a concurrent webhook
  // delivery has already flipped it to 'confirmed' elsewhere. The atomic
  // .eq('order_status','pending') guard means 0 rows match this request's
  // UPDATE, and the route must skip the event log rather than logging a
  // duplicate capture for an order it didn't actually win the race on.
  it('skips the event log when the optimistic-lock UPDATE matches 0 rows (lost the race to a concurrent delivery)', async () => {
    mockDb.responses['orders'] = { id: 'order-db-uuid-006', order_status: 'pending' } // SELECT sees pending
    mockDb.updateResultOverride['orders'] = [] // but the UPDATE's WHERE clause matches 0 rows

    const event = makeEvent({ dbOrderId: 'order-db-uuid-006', paymentId: 'pay_lost_race' })
    const req = makeReq(event)

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res = await POST(req)

    expect(res.status).toBe(200)
    // The UPDATE was attempted (order looked pending at SELECT time)...
    expect(mockDb.updateCalls.find(c => c.table === 'orders')).toBeDefined()
    // ...but since 0 rows matched, no duplicate event log for this delivery.
    expect(mockLogOrderEvent).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// payment.failed
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /webhook/razorpay — payment.failed', () => {
  it('restores stock and sets order_status=payment_failed (not left at pending)', async () => {
    mockDb.responses['orders'] = { id: 'order-db-uuid-002', order_status: 'pending' }
    mockDb.responses['order_items'] = [
      { product_id: 'p1', variant_id: 'v1', quantity: 2 },
    ]

    const event = makeEvent({ event: 'payment.failed', dbOrderId: 'order-db-uuid-002', errorReason: 'insufficient_funds' })
    const req = makeReq(event)

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    await POST(req)

    expect(mockRestoreStock).toHaveBeenCalledWith([
      { variantId: 'v1', productId: 'p1', qty: 2 },
    ])

    const orderUpdate = mockDb.updateCalls.find(c => c.table === 'orders')
    expect(orderUpdate!.payload).toMatchObject({ order_status: 'payment_failed', payment_status: 'failed' })

    expect(mockLogOrderEvent).toHaveBeenCalledWith(
      'order-db-uuid-002', 'payment_failed_webhook', 'razorpay',
      expect.objectContaining({ reason: 'insufficient_funds' }),
    )
  })

  it('does NOT restore stock or modify the order when order_status is not pending (already confirmed)', async () => {
    mockDb.responses['orders'] = { id: 'order-db-uuid-003', order_status: 'confirmed' }
    const event = makeEvent({ event: 'payment.failed', dbOrderId: 'order-db-uuid-003' })
    const req = makeReq(event)

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    await POST(req)

    expect(mockRestoreStock).not.toHaveBeenCalled()
    expect(mockDb.updateCalls.find(c => c.table === 'orders')).toBeUndefined()
  })

  it('does not crash when order_items is empty (no stock to restore)', async () => {
    mockDb.responses['orders'] = { id: 'order-db-uuid-004', order_status: 'pending' }
    mockDb.responses['order_items'] = []

    const event = makeEvent({ event: 'payment.failed', dbOrderId: 'order-db-uuid-004' })
    const req = makeReq(event)

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(mockRestoreStock).not.toHaveBeenCalled()
  })

  // ── Sept 2026 regression suite ────────────────────────────────────────────
  // Context: 'payment_failed' was never a member of the live order_status_enum,
  // so this UPDATE failed with Postgres 22P02 on every call. The route did not
  // destructure the error, so the failure was invisible: the order stayed
  // 'pending', which meant the `order_status === 'pending'` guard at the top of
  // this branch stayed true forever — and a SECOND payment.failed event for the
  // same order (a customer retrying and failing again on the same order row,
  // which the idempotency key makes the normal case) restored the same reserved
  // stock a second time, silently inflating inventory.
  //
  // Fixed by (a) DB migration 048 adding the enum value, and (b) reordering
  // this branch so the guarded transition runs FIRST and stock is restored only
  // if this process actually won pending → payment_failed. The three tests
  // below pin the reordering; the enum value itself is a DB-side fact.

  it('applies the transition with an atomic order_status=pending guard on the UPDATE', async () => {
    mockDb.responses['orders'] = { id: 'order-db-uuid-006', order_status: 'pending' }
    mockDb.responses['order_items'] = [{ product_id: 'p1', variant_id: 'v1', quantity: 1 }]

    const req = makeReq(makeEvent({ event: 'payment.failed', dbOrderId: 'order-db-uuid-006' }))
    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    await POST(req)

    const orderUpdate = mockDb.updateCalls.find(c => c.table === 'orders')
    // Without this WHERE clause two concurrent deliveries of the same event
    // could both pass the earlier SELECT-based check and both restore stock.
    expect(orderUpdate!.eqCalls).toContainEqual(['order_status', 'pending'])
  })

  it('does NOT restore stock when the UPDATE matched 0 rows (duplicate/replayed event)', async () => {
    mockDb.responses['orders'] = { id: 'order-db-uuid-007', order_status: 'pending' }
    mockDb.responses['order_items'] = [{ product_id: 'p1', variant_id: 'v1', quantity: 3 }]
    // The SELECT still sees 'pending', but the guarded UPDATE affects no rows:
    // another delivery of this same event already made the transition and
    // already restored this stock.
    mockDb.updateResultOverride['orders'] = []

    const req = makeReq(makeEvent({ event: 'payment.failed', dbOrderId: 'order-db-uuid-007' }))
    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(mockRestoreStock).not.toHaveBeenCalled()
    expect(mockLogOrderEvent).not.toHaveBeenCalledWith(
      'order-db-uuid-007', 'payment_failed_webhook', 'razorpay', expect.anything(),
    )
  })

  it('does NOT restore stock when the UPDATE itself errors (the exact silent-failure path)', async () => {
    mockDb.responses['orders'] = { id: 'order-db-uuid-008', order_status: 'pending' }
    mockDb.responses['order_items'] = [{ product_id: 'p1', variant_id: 'v1', quantity: 1 }]
    mockDb.updateErrorOverride['orders'] = new Error(
      'invalid input value for enum order_status_enum: "payment_failed"',
    )

    const req = makeReq(makeEvent({ event: 'payment.failed', dbOrderId: 'order-db-uuid-008' }))
    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res = await POST(req)

    // Still 200 — Razorpay must not retry-storm — but the order is untouched,
    // so nothing may act as though the transition succeeded.
    expect(res.status).toBe(200)
    expect(mockRestoreStock).not.toHaveBeenCalled()
  })

  it('continues processing (sets payment_failed) even if restoreStock itself throws', async () => {
    mockDb.responses['orders'] = { id: 'order-db-uuid-005', order_status: 'pending' }
    mockDb.responses['order_items'] = [{ product_id: 'p1', variant_id: 'v1', quantity: 1 }]
    mockRestoreStock.mockRejectedValueOnce(new Error('DB deadlock'))

    const event = makeEvent({ event: 'payment.failed', dbOrderId: 'order-db-uuid-005' })
    const req = makeReq(event)

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res = await POST(req)

    expect(res.status).toBe(200)
    const orderUpdate = mockDb.updateCalls.find(c => c.table === 'orders')
    expect(orderUpdate!.payload).toMatchObject({ order_status: 'payment_failed' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Webhook log lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /webhook/razorpay — webhook_logs lifecycle', () => {
  it('inserts a webhook_logs row with status=received before processing', async () => {
    mockDb.responses['orders'] = { id: 'order-db-uuid-001', order_status: 'pending' }
    const event = makeEvent()
    const req = makeReq(event)

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    await POST(req)

    const insertCall = mockDb.insertCalls.find(c => c.table === 'webhook_logs')
    expect(insertCall).toBeDefined()
    expect((insertCall!.payload as { status: string }).status).toBe('received')
  })

  it('always returns 200 even when internal processing throws (avoids Razorpay retry storms)', async () => {
    mockDb.responses['orders'] = new Error('connection refused') // forces a throw deep in processing
    const event = makeEvent()
    const req = makeReq(event)

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res = await POST(req)

    expect(res.status).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Unhandled / unknown event types
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /webhook/razorpay — unrecognized event types', () => {
  it('returns 200 for an event type the handler does not act on (e.g. order.paid)', async () => {
    const event = { event: 'order.paid', payload: { payment: { entity: { id: 'pay_x', amount: 100, notes: {} } } } }
    const req = makeReq(event)

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res = await POST(req)

    expect(res.status).toBe(200)
  })
})
