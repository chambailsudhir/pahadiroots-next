/**
 * retryFailedEmailsRoute.test.ts
 *
 * Direct route-level tests for GET /api/v1/cron/retry-failed-emails — the
 * background sweep that retries dead-lettered transactional emails (see
 * lib/server/email.ts and db_migration_v5_email_dlq.sql).
 *
 * Covered here:
 *   1. [SECURITY] Missing CRON_SECRET env var → 500, fails closed rather
 *      than ever running as an open endpoint.
 *   2. [SECURITY] Wrong/missing Authorization header → 401, no DB access
 *      attempted at all.
 *   3. Happy path — a pending row sends successfully and is marked 'sent'.
 *   4. A row that fails again is requeued as 'pending' with attempts
 *      incremented and next_retry_at pushed into the future (exponential
 *      backoff), NOT marked 'dead' before MAX_DLQ_ATTEMPTS.
 *   5. A row that reaches MAX_DLQ_ATTEMPTS is marked 'dead' for manual ops
 *      investigation, not retried forever.
 *   6. [RACE FIX] The atomic claim step (UPDATE ... WHERE status='pending')
 *      means a row already claimed by a concurrent invocation (0 rows
 *      updated) is skipped — no duplicate send — mirroring the same TOCTOU
 *      guard pattern already used in webhook/razorpay/route.ts.
 *   7. Uses each row's own from_address (not a hardcoded sender) — needed
 *      because contact-form notifications use a distinct sender name.
 *   8. No candidates → returns a clean zero-counts summary, no errors.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

const ORIGINAL_ENV = { ...process.env }

// ─── Mock: resend — controllable per-row via mockSend ─────────────────────────
const mockSend = vi.fn()
vi.mock('resend', () => ({
  // Must be a real `function`, not an arrow function — arrow functions have
  // no [[Construct]] slot and throw "is not a constructor" under `new`.
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: mockSend } }
  }),
}))

// ─── Minimal Supabase mock for the failed_emails table ────────────────────────
interface CandidateRow {
  id: string
  type: string
  to_email: string
  from_address: string
  subject: string
  html: string
  attempts: number
}

interface MockDb {
  candidates: CandidateRow[]
  // id -> false means a concurrent invocation already claimed this row
  claimableOverride: Record<string, boolean>
  updateCalls: Array<{ payload: Record<string, unknown>; eqCalls: unknown[][] }>
}
let mockDb: MockDb

function resetMockDb() {
  mockDb = { candidates: [], claimableOverride: {}, updateCalls: [] }
}

function buildQueryBuilder() {
  let mode: 'select' | 'update' | null = null
  let wentThroughSelectAfterUpdate = false
  let eqCalls: unknown[][] = []
  let currentUpdate: { payload: Record<string, unknown>; eqCalls: unknown[][] } | null = null

  const builder: Record<string, (...a: unknown[]) => unknown> = {
    select: () => {
      if (mode === 'update') wentThroughSelectAfterUpdate = true
      else mode = 'select'
      return builder
    },
    update: (payload: unknown) => {
      mode = 'update'
      currentUpdate = { payload: payload as Record<string, unknown>, eqCalls: [] }
      eqCalls = currentUpdate.eqCalls
      mockDb.updateCalls.push(currentUpdate)
      return builder
    },
    eq: (...args: unknown[]) => { eqCalls.push(args); return builder },
    lte: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (...a: unknown[]) => {
      let result: { data: unknown; error: unknown }
      if (mode === 'select') {
        result = { data: mockDb.candidates, error: null }
      } else {
        // mode === 'update'
        if (wentThroughSelectAfterUpdate) {
          // The atomic claim step: .update({status:'retrying'}).eq('id', id).eq('status','pending').select('id')
          const id = eqCalls[0]?.[1] as string
          const claimable = mockDb.claimableOverride[id] !== false
          result = { data: claimable ? [{ id }] : [], error: null }
        } else {
          result = { data: null, error: null }
        }
      }
      return Promise.resolve(result).then(a[0] as (v: unknown) => unknown)
    },
  }
  return builder
}

vi.mock('@/lib/supabase', () => ({
  getServiceClient: () => ({ from: () => buildQueryBuilder() }),
  supabase: {},
}))

function makeReq(authHeader?: string): NextRequest {
  const headers = new Headers()
  if (authHeader !== undefined) headers.set('authorization', authHeader)
  return new Request('http://localhost/api/v1/cron/retry-failed-emails', { headers }) as unknown as NextRequest
}

function row(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: 'fe-1',
    type: 'order_confirmation',
    to_email: 'customer@example.com',
    from_address: 'Pahadi Roots <noreply@pahadiroots.com>',
    subject: 'Order Confirmed',
    html: '<p>Thanks!</p>',
    attempts: 0,
    ...overrides,
  }
}

beforeEach(() => {
  resetMockDb()
  mockSend.mockReset()
  vi.resetModules()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.restoreAllMocks()
})

describe('GET /api/v1/cron/retry-failed-emails — auth', () => {
  it('fails closed with 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET
    const { GET } = await import('@/app/api/v1/cron/retry-failed-emails/route')

    const res = await GET(makeReq('Bearer anything'))
    expect(res.status).toBe(500)
    expect(mockDb.updateCalls.length).toBe(0)
  })

  it('rejects with 401 when the Authorization header is missing', async () => {
    process.env.CRON_SECRET = 'test-cron-secret'
    const { GET } = await import('@/app/api/v1/cron/retry-failed-emails/route')

    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('rejects with 401 when the Authorization header has the wrong secret', async () => {
    process.env.CRON_SECRET = 'test-cron-secret'
    const { GET } = await import('@/app/api/v1/cron/retry-failed-emails/route')

    const res = await GET(makeReq('Bearer wrong-secret'))
    expect(res.status).toBe(401)
  })

  it('proceeds when the Authorization header matches CRON_SECRET', async () => {
    process.env.CRON_SECRET = 'test-cron-secret'
    mockDb.candidates = []
    const { GET } = await import('@/app/api/v1/cron/retry-failed-emails/route')

    const res = await GET(makeReq('Bearer test-cron-secret'))
    expect(res.status).toBe(200)
  })
})

describe('GET /api/v1/cron/retry-failed-emails — processing', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret'
  })

  it('returns a clean zero-counts summary when there are no candidates', async () => {
    mockDb.candidates = []
    const { GET } = await import('@/app/api/v1/cron/retry-failed-emails/route')

    const res  = await GET(makeReq('Bearer test-cron-secret'))
    const json = await res.json()

    expect(json).toEqual({ candidates: 0, claimed: 0, sent: 0, stillFailing: 0, dead: 0 })
  })

  it('happy path: a pending row sends successfully and is marked sent', async () => {
    mockDb.candidates = [row({ id: 'fe-1' })]
    mockSend.mockResolvedValue({ data: { id: 'email_ok' }, error: null })
    const { GET } = await import('@/app/api/v1/cron/retry-failed-emails/route')

    const res  = await GET(makeReq('Bearer test-cron-secret'))
    const json = await res.json()

    expect(json).toEqual({ candidates: 1, claimed: 1, sent: 1, stillFailing: 0, dead: 0 })
    const finalUpdate = mockDb.updateCalls.at(-1)!
    expect(finalUpdate.payload.status).toBe('sent')
  })

  it('uses the row\'s own from_address rather than a hardcoded sender', async () => {
    mockDb.candidates = [row({ id: 'fe-1', from_address: 'Pahadi Roots Contact <noreply@pahadiroots.com>' })]
    mockSend.mockResolvedValue({ data: { id: 'email_ok' }, error: null })
    const { GET } = await import('@/app/api/v1/cron/retry-failed-emails/route')

    await GET(makeReq('Bearer test-cron-secret'))

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Pahadi Roots Contact <noreply@pahadiroots.com>' }),
    )
  })

  it('a row that fails again is requeued as pending with attempts incremented and backoff applied, not marked dead', async () => {
    mockDb.candidates = [row({ id: 'fe-1', attempts: 1 })]
    mockSend.mockResolvedValue({ data: null, error: { name: 'application_error', message: 'still down' } })
    const { GET } = await import('@/app/api/v1/cron/retry-failed-emails/route')

    const res  = await GET(makeReq('Bearer test-cron-secret'))
    const json = await res.json()

    expect(json).toEqual({ candidates: 1, claimed: 1, sent: 0, stillFailing: 1, dead: 0 })
    const finalUpdate = mockDb.updateCalls.at(-1)!
    expect(finalUpdate.payload.status).toBe('pending')
    expect(finalUpdate.payload.attempts).toBe(2)
    expect(typeof finalUpdate.payload.next_retry_at).toBe('string')
    // Backoff window must be pushed into the future, not left at "now".
    expect(new Date(finalUpdate.payload.next_retry_at as string).getTime()).toBeGreaterThan(Date.now())
  })

  it('a row reaching MAX_DLQ_ATTEMPTS is marked dead, not requeued indefinitely', async () => {
    const { MAX_DLQ_ATTEMPTS } = await import('@/lib/server/email')
    mockDb.candidates = [row({ id: 'fe-1', attempts: MAX_DLQ_ATTEMPTS - 1 })]
    mockSend.mockResolvedValue({ data: null, error: { name: 'application_error', message: 'permanently down' } })
    const { GET } = await import('@/app/api/v1/cron/retry-failed-emails/route')

    const res  = await GET(makeReq('Bearer test-cron-secret'))
    const json = await res.json()

    expect(json).toEqual({ candidates: 1, claimed: 1, sent: 0, stillFailing: 0, dead: 1 })
    const finalUpdate = mockDb.updateCalls.at(-1)!
    expect(finalUpdate.payload.status).toBe('dead')
    expect(finalUpdate.payload.attempts).toBe(MAX_DLQ_ATTEMPTS)
  })

  it('[RACE FIX] skips a row already claimed by a concurrent invocation — no duplicate send', async () => {
    mockDb.candidates = [row({ id: 'fe-1' })]
    mockDb.claimableOverride['fe-1'] = false // simulates another invocation winning the claim first
    mockSend.mockResolvedValue({ data: { id: 'email_ok' }, error: null })
    const { GET } = await import('@/app/api/v1/cron/retry-failed-emails/route')

    const res  = await GET(makeReq('Bearer test-cron-secret'))
    const json = await res.json()

    expect(json).toEqual({ candidates: 1, claimed: 0, sent: 0, stillFailing: 0, dead: 0 })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('a thrown exception during send is treated the same as a resolved error (requeued, not crashed)', async () => {
    mockDb.candidates = [row({ id: 'fe-1', attempts: 0 })]
    mockSend.mockRejectedValue(new Error('ECONNRESET'))
    const { GET } = await import('@/app/api/v1/cron/retry-failed-emails/route')

    const res  = await GET(makeReq('Bearer test-cron-secret'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.stillFailing).toBe(1)
  })

  it('processes multiple rows independently — one success and one failure in the same sweep', async () => {
    mockDb.candidates = [
      row({ id: 'fe-1', to_email: 'a@example.com' }),
      row({ id: 'fe-2', to_email: 'b@example.com' }),
    ]
    mockSend
      .mockResolvedValueOnce({ data: { id: 'ok' }, error: null })
      .mockResolvedValueOnce({ data: null, error: { name: 'application_error', message: 'down' } })
    const { GET } = await import('@/app/api/v1/cron/retry-failed-emails/route')

    const res  = await GET(makeReq('Bearer test-cron-secret'))
    const json = await res.json()

    expect(json.candidates).toBe(2)
    expect(json.claimed).toBe(2)
    expect(json.sent).toBe(1)
    expect(json.stillFailing).toBe(1)
  })
})
