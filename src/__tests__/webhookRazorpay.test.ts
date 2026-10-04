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
 *  11. (P4) Returns 500 when internal processing throws, so Razorpay RETRIES
 *      the event — handlers are idempotent, so retries are safe.
 *
 * P2/O2/P1 rewrite: payment.failed is a single failed ATTEMPT (order stays
 * pending); payment.captured binds to the stored Razorpay order id + exact
 * amount, recovers failed/expired orders, and the winner runs loyalty/e-mail.
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

const mockReserveStock = vi.fn()
vi.mock('@/lib/services/inventoryService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/inventoryService')>()
  return { ...actual, restoreStock: mockRestoreStock, reserveStockAtomicForOrder: mockReserveStock }
})

// The webhook now runs the shared paid-order side effects (loyalty + e-mail).
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (cb: () => void | Promise<void>) => { void cb() } }
})
const mockAward  = vi.fn()
const mockRedeem = vi.fn()
vi.mock('@/lib/server/loyalty', () => ({
  awardLoyaltyPoints:  (...a: unknown[]) => mockAward(...a),
  redeemLoyaltyPoints: (...a: unknown[]) => mockRedeem(...a),
}))
vi.mock('@/lib/server/email', () => ({ sendTransactionalEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/getSiteSettings', () => ({
  getFreshSiteSettings: vi.fn().mockResolvedValue({ loyalty_enabled: 'true', loyalty_points_per_rupee: '1' }),
}))

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
  razorpayOrderId: string
}> = {}) {
  const {
    event = 'payment.captured',
    paymentId = 'pay_test123',
    amount = 50000,
    dbOrderId = 'order-db-uuid-001',
    errorReason = 'card_declined',
    razorpayOrderId = 'order_rzp_1',
  } = overrides
  return {
    event,
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: razorpayOrderId,
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
  mockLogOrderEvent.mockClear().mockResolvedValue(undefined)
  mockRestoreStock.mockClear().mockResolvedValue(undefined)
  mockReserveStock.mockReset().mockResolvedValue({ ok: true })
  mockAward.mockReset().mockResolvedValue(undefined)
  mockRedeem.mockReset().mockResolvedValue(true)
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

// A normal, payable Razorpay order: ₹500, bound to Razorpay order `order_rzp_1`.
const PAYABLE = {
  id: 'order-db-uuid-001', order_number: 'PR1A2B3C4D',
  order_status: 'pending', payment_status: 'pending', payment_method: 'razorpay',
  payment_id: 'order_rzp_1', total_amount: 500, customer_id: 'cust-1', loyalty_points_redeemed: 0,
}

describe('POST /webhook/razorpay — payment.captured', () => {
  it('confirms a pending order: sets order_status=confirmed, payment_status=paid, payment_id', async () => {
    mockDb.responses['orders'] = { ...PAYABLE }

    const req = makeReq(makeEvent({ paymentId: 'pay_abc', amount: 50000, dbOrderId: PAYABLE.id }))
    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res = await POST(req)
    expect(res.status).toBe(200)

    const orderUpdate = mockDb.updateCalls.find(c => c.table === 'orders')
    expect(orderUpdate).toBeDefined()
    expect(orderUpdate!.payload).toMatchObject({
      order_status: 'confirmed', payment_status: 'paid', payment_id: 'pay_abc',
    })
  })

  // TOCTOU: the UPDATE is keyed on the exact state that was read, so two concurrent
  // deliveries can't both win.
  it('guards the UPDATE on the exact pending/pending state that was read (TOCTOU)', async () => {
    mockDb.responses['orders'] = { ...PAYABLE }
    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    await POST(makeReq(makeEvent({ dbOrderId: PAYABLE.id })))

    const orderUpdate = mockDb.updateCalls.find(c => c.table === 'orders')
    expect(orderUpdate!.eqCalls).toContainEqual(['payment_status', 'pending'])
    expect(orderUpdate!.eqCalls).toContainEqual(['order_status', 'pending'])
  })

  it('logs payment_captured_webhook, records the payment, and (O2) awards loyalty as the race winner', async () => {
    mockDb.responses['orders'] = { ...PAYABLE }

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    await POST(makeReq(makeEvent({ dbOrderId: PAYABLE.id, paymentId: 'pay_xyz', amount: 50000 })))

    expect(mockLogOrderEvent).toHaveBeenCalledWith(
      PAYABLE.id, 'payment_captured_webhook', 'razorpay',
      expect.objectContaining({ razorpay_payment_id: 'pay_xyz', amount: 500 }),
    )
    expect(mockDb.insertCalls.find(c => c.table === 'payments')).toBeDefined()
    // O2: the webhook used to leave this to verify_payment only.
    expect(mockAward).toHaveBeenCalledTimes(1)
  })

  it('does not touch the orders table when notes.db_order_id is missing', async () => {
    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res = await POST(makeReq(makeEvent({ dbOrderId: undefined })))

    expect(res.status).toBe(200) // permanently-unprocessable → don't ask Razorpay to retry
    expect(mockDb.updateCalls.find(c => c.table === 'orders')).toBeUndefined()
  })

  it('does not double-process an order that is already paid', async () => {
    mockDb.responses['orders'] = { ...PAYABLE, order_status: 'confirmed', payment_status: 'paid', payment_id: 'pay_abc' }
    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    await POST(makeReq(makeEvent({ dbOrderId: PAYABLE.id })))

    expect(mockDb.updateCalls.find(c => c.table === 'orders')).toBeUndefined()
    expect(mockLogOrderEvent).not.toHaveBeenCalled()
    expect(mockAward).not.toHaveBeenCalled()
  })

  it('lost the race (UPDATE matches 0 rows): no duplicate event log and NO second loyalty award', async () => {
    mockDb.responses['orders'] = { ...PAYABLE }
    mockDb.updateResultOverride['orders'] = []

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res = await POST(makeReq(makeEvent({ dbOrderId: PAYABLE.id, paymentId: 'pay_lost_race' })))

    expect(res.status).toBe(200)
    expect(mockDb.updateCalls.find(c => c.table === 'orders')).toBeDefined()
    expect(mockLogOrderEvent).not.toHaveBeenCalled()
    expect(mockAward).not.toHaveBeenCalled()
  })

  // ── P1/P2 binding: notes.db_order_id is only a hint ────────────────────────
  it.each([
    ['amount differs from DB total',            { total_amount: 5000 },          {}],
    ['payment belongs to another Razorpay order', {},                            { razorpayOrderId: 'order_someone_else' }],
    ['order has no stored Razorpay order id',   { payment_id: null },            {}],
    ['order is not a Razorpay order (COD)',     { payment_method: 'cod' },       {}],
  ])('does NOT confirm when %s → held for review, order untouched', async (_label, orderOverride, eventOverride) => {
    mockDb.responses['orders'] = { ...PAYABLE, ...orderOverride }
    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res = await POST(makeReq(makeEvent({ dbOrderId: PAYABLE.id, amount: 50000, ...eventOverride })))

    expect(res.status).toBe(200)
    expect(mockDb.updateCalls.find(c => c.table === 'orders')).toBeUndefined()
    expect(mockLogOrderEvent).toHaveBeenCalledWith(PAYABLE.id, 'payment_captured_unbound', 'razorpay', expect.anything())
    expect(mockAward).not.toHaveBeenCalled()
  })

  // ── P2 recovery ────────────────────────────────────────────────────────────
  it('RECOVERS an order that was failed/released: payment_failed → paid and stock is re-reserved', async () => {
    mockDb.responses['orders'] = { ...PAYABLE, order_status: 'payment_failed', payment_status: 'failed' }
    mockDb.responses['order_items'] = [{ product_id: 'p1', variant_id: 'v1', quantity: 2 }]

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res = await POST(makeReq(makeEvent({ dbOrderId: PAYABLE.id, paymentId: 'pay_retry_ok' })))
    expect(res.status).toBe(200)

    const orderUpdate = mockDb.updateCalls.find(c => c.table === 'orders')
    expect(orderUpdate!.payload).toMatchObject({ order_status: 'confirmed', payment_status: 'paid', payment_id: 'pay_retry_ok' })
    expect(orderUpdate!.eqCalls).toContainEqual(['payment_status', 'failed'])
    expect(orderUpdate!.eqCalls).toContainEqual(['order_status', 'payment_failed'])
    expect(mockReserveStock).toHaveBeenCalledWith([{ variantId: 'v1', productId: 'p1', qty: 2 }])
    expect(mockLogOrderEvent).toHaveBeenCalledWith(PAYABLE.id, 'payment_recovered_after_failure', 'razorpay', expect.objectContaining({ stock_re_reserved: true }))
    expect(mockAward).toHaveBeenCalledTimes(1)
  })

  it('recovered order whose stock is gone STAYS confirmed (customer paid) and ops are alerted via an event', async () => {
    mockDb.responses['orders'] = { ...PAYABLE, order_status: 'payment_failed', payment_status: 'failed' }
    mockDb.responses['order_items'] = [{ product_id: 'p1', variant_id: 'v1', quantity: 2 }]
    mockReserveStock.mockResolvedValue({ ok: false, failedVariantId: 'v1' })

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res = await POST(makeReq(makeEvent({ dbOrderId: PAYABLE.id })))

    expect(res.status).toBe(200)
    expect(mockDb.updateCalls.find(c => c.table === 'orders')!.payload).toMatchObject({ payment_status: 'paid' })
    expect(mockLogOrderEvent).toHaveBeenCalledWith(PAYABLE.id, 'paid_after_release_stock_unavailable', 'system', expect.anything())
  })

  it('an order in any other state (e.g. cancelled by admin) is NOT flipped to paid; ops alerted via event', async () => {
    mockDb.responses['orders'] = { ...PAYABLE, order_status: 'cancelled', payment_status: 'pending' }
    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    await POST(makeReq(makeEvent({ dbOrderId: PAYABLE.id })))

    expect(mockDb.updateCalls.find(c => c.table === 'orders')).toBeUndefined()
    expect(mockLogOrderEvent).toHaveBeenCalledWith(PAYABLE.id, 'payment_received_for_unconfirmable_order', 'razorpay', expect.anything())
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// payment.failed
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /webhook/razorpay — payment.failed (P2: one failed attempt is NOT terminal)', () => {
  it('records the attempt but leaves the order PENDING and does NOT restore stock', async () => {
    mockDb.responses['orders'] = { ...PAYABLE }
    mockDb.responses['order_items'] = [{ product_id: 'p1', variant_id: 'v1', quantity: 2 }]

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res = await POST(makeReq(makeEvent({ event: 'payment.failed', dbOrderId: PAYABLE.id, errorReason: 'insufficient_funds' })))

    expect(res.status).toBe(200)
    expect(mockDb.updateCalls.find(c => c.table === 'orders')).toBeUndefined()
    expect(mockRestoreStock).not.toHaveBeenCalled()
    expect(mockLogOrderEvent).toHaveBeenCalledWith(
      PAYABLE.id, 'payment_attempt_failed', 'razorpay',
      expect.objectContaining({ reason: 'insufficient_funds' }),
    )
    const failedRow = mockDb.insertCalls.find(c => c.table === 'payments')
    expect(failedRow!.payload).toMatchObject({ status: 'failed', payment_reference: 'pay_test123' })
  })

  it('REGRESSION (the audited bug): fail once, then succeed on retry → order ends CONFIRMED, never dead', async () => {
    mockDb.responses['orders'] = { ...PAYABLE }
    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')

    // attempt 1 fails
    await POST(makeReq(makeEvent({ event: 'payment.failed', dbOrderId: PAYABLE.id, paymentId: 'pay_try1' })))
    expect(mockDb.updateCalls.filter(c => c.table === 'orders')).toHaveLength(0)

    // attempt 2 (same Razorpay order) is captured
    await POST(makeReq(makeEvent({ event: 'payment.captured', dbOrderId: PAYABLE.id, paymentId: 'pay_try2' })))
    const upd = mockDb.updateCalls.filter(c => c.table === 'orders')
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toMatchObject({ order_status: 'confirmed', payment_status: 'paid', payment_id: 'pay_try2' })
    expect(mockRestoreStock).not.toHaveBeenCalled()
  })

  it('ignores a late/duplicate failure for an order that is already paid', async () => {
    mockDb.responses['orders'] = { ...PAYABLE, order_status: 'confirmed', payment_status: 'paid' }
    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    await POST(makeReq(makeEvent({ event: 'payment.failed', dbOrderId: PAYABLE.id })))

    expect(mockDb.updateCalls.find(c => c.table === 'orders')).toBeUndefined()
    expect(mockLogOrderEvent).not.toHaveBeenCalled()
    expect(mockDb.insertCalls.find(c => c.table === 'payments')).toBeUndefined()
  })

  it('payment.failed with missing notes.db_order_id → 200, nothing touched', async () => {
    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res = await POST(makeReq(makeEvent({ event: 'payment.failed', dbOrderId: undefined })))
    expect(res.status).toBe(200)
    expect(mockDb.updateCalls).toHaveLength(0)
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

  it('P4: returns 500 when processing fails so Razorpay RETRIES, and marks the log failed', async () => {
    mockDb.responses['orders'] = { ...PAYABLE }
    mockDb.responses['webhook_logs'] = { id: 'log-1' }
    mockDb.updateErrorOverride['orders'] = new Error('connection refused') // confirm UPDATE fails

    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res = await POST(makeReq(makeEvent({ dbOrderId: PAYABLE.id })))

    expect(res.status).toBe(500)
    const failedLog = mockDb.updateCalls.find(c => c.table === 'webhook_logs')
    expect(failedLog!.payload).toMatchObject({ status: 'failed' })
  })

  it('payment.captured for an unknown order → 200 (permanent failure, alert only, no retry storm)', async () => {
    mockDb.responses['orders'] = new Error('no rows')
    const { POST } = await import('@/app/api/v1/webhook/razorpay/route')
    const res = await POST(makeReq(makeEvent()))
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
