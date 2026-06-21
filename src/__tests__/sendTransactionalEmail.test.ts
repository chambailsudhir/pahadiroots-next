/**
 * sendTransactionalEmail.test.ts
 *
 * Tests for lib/server/email.ts — the shared helper that replaced four
 * separate inline `resend.emails.send()` call sites (orders/route.ts x2,
 * payments/route.ts, actions/route.ts).
 *
 * THE CORE BUG this fixes: the Resend SDK's `emails.send()` does not reject
 * on an API-level failure (bad key, unverified domain, bounce, quota/rate
 * limit) — it always RESOLVES with `{ data: null, error }`. Every existing
 * call site only logged on a *thrown* exception, so none of them ever
 * caught this. Confirmed directly against the installed SDK
 * (node_modules/resend/dist/index.mjs `fetchRequest()`), which wraps its
 * own fetch in try/catch and returns `{ data: null, error }` in EVERY
 * failure branch — it never lets an error propagate out as a rejection.
 *
 * Covered here:
 *   1. Happy path — resolves { sent: true }, no DB write.
 *   2. Resend resolving with `{ error }` (no throw) is correctly detected
 *      as a failure — this is the exact bug; a naive try/catch wrapper
 *      would have missed it entirely.
 *   3. A genuinely thrown exception (network/timeout) is also handled.
 *   4. Retries inline before giving up (bounded — not unbounded).
 *   5. A transient failure that succeeds on retry never reaches the DLQ.
 *   6. Exhausting inline retries inserts a dead-letter row with the right
 *      shape (type, to_email, from_address, subject, html, context, status).
 *   7. The function NEVER throws, even when the DLQ insert itself fails —
 *      callers don't need their own try/catch.
 *   8. The `from` override (used by actions/route.ts's contact-form email)
 *      is honoured both on send and in the persisted dead-letter row.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mock: resend — controllable per-test via mockSend ───────────────────────
//
// IMPORTANT: must use a real `function` here, not an arrow function. Arrow
// functions have no [[Construct]] internal slot and can never be invoked
// with `new` — vi.fn().mockImplementation(() => ({...})) throws "is not a
// constructor" the moment `new Resend(...)` runs. (This exact pitfall was
// already latent in paymentOrderRoutes.test.ts's identical-looking mock; it
// never surfaced there because that file deliberately sets
// order_email_enabled: 'false', so its tests never actually reach a
// `new Resend(...)` call.)
const mockSend = vi.fn()
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: mockSend } }
  }),
}))

// ─── Mock: @/lib/supabase — captures failed_emails inserts ───────────────────
const insertCalls: Array<{ table: string; payload: unknown }> = []
let insertShouldFail = false
let insertShouldThrow = false

vi.mock('@/lib/supabase', () => ({
  getServiceClient: () => ({
    from: (table: string) => ({
      insert: (payload: unknown) => {
        insertCalls.push({ table, payload })
        if (insertShouldThrow) return Promise.reject(new Error('connection refused'))
        return Promise.resolve(
          insertShouldFail
            ? { data: null, error: { message: 'simulated DB failure' } }
            : { data: null, error: null },
        )
      },
    }),
  }),
}))

const { sendTransactionalEmail } = await import('@/lib/server/email')

describe('sendTransactionalEmail', () => {
  beforeEach(() => {
    mockSend.mockReset()
    insertCalls.length = 0
    insertShouldFail = false
    insertShouldThrow = false
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('happy path: resolves { sent: true } and writes nothing to the DLQ', async () => {
    mockSend.mockResolvedValue({ data: { id: 'email_123' }, error: null })

    const result = await sendTransactionalEmail({
      type: 'order_confirmation', to: 'customer@example.com',
      subject: 'Order Confirmed', html: '<p>Thanks!</p>',
    })

    expect(result).toEqual({ sent: true })
    expect(insertCalls.length).toBe(0)
  })

  it('[CORE BUG] detects a Resend API-level rejection that RESOLVES with { error } rather than throwing', async () => {
    // This is exactly what the real SDK does for a bad API key, unverified
    // domain, bounced recipient, or rate limit — see fetchRequest() in
    // node_modules/resend/dist/index.mjs. A bare try/catch around
    // `await resend.emails.send(...)` (the old code at every call site)
    // would NEVER see this as a failure.
    mockSend.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'Invalid `to` field' },
    })

    const result = await sendTransactionalEmail({
      type: 'order_confirmation', to: 'bad@@example.com',
      subject: 'Order Confirmed', html: '<p>Thanks!</p>',
    })

    expect(result.sent).toBe(false)
    expect(result.error).toContain('Invalid `to` field')
    // Exhausted retries on a resolved-error response too — must reach the DLQ.
    expect(insertCalls.length).toBe(1)
  })

  it('handles a genuinely thrown exception (network failure / our own timeout)', async () => {
    mockSend.mockRejectedValue(new Error('fetch failed: ECONNRESET'))

    const result = await sendTransactionalEmail({
      type: 'payment_confirmation', to: 'customer@example.com',
      subject: 'Payment Confirmed', html: '<p>Paid!</p>',
      timeoutMs: 1000,
    })

    expect(result.sent).toBe(false)
    expect(result.error).toContain('ECONNRESET')
    expect(insertCalls.length).toBe(1)
  })

  it('retries inline a bounded number of times, not unboundedly', async () => {
    mockSend.mockResolvedValue({ data: null, error: { name: 'rate_limit_exceeded', message: 'Too many requests' } })

    await sendTransactionalEmail({
      type: 'contact_form', to: 'admin@pahadiroots.com',
      subject: 'Contact form', html: '<p>Hi</p>',
    })

    // Bounded — exactly the documented inline attempt count, not a retry storm.
    expect(mockSend.mock.calls.length).toBe(2)
  })

  it('a transient failure that succeeds on the inline retry never reaches the DLQ', async () => {
    mockSend
      .mockResolvedValueOnce({ data: null, error: { name: 'application_error', message: 'temporary glitch' } })
      .mockResolvedValueOnce({ data: { id: 'email_456' }, error: null })

    const result = await sendTransactionalEmail({
      type: 'admin_order_notify', to: 'admin@pahadiroots.com',
      subject: 'New order', html: '<p>Order details</p>',
    })

    expect(result).toEqual({ sent: true })
    expect(insertCalls.length).toBe(0)
    expect(mockSend.mock.calls.length).toBe(2)
  })

  it('dead-letters with the full row shape (type, to_email, from_address, subject, html, context, status)', async () => {
    mockSend.mockResolvedValue({ data: null, error: { name: 'application_error', message: 'Resend is down' } })

    await sendTransactionalEmail({
      type: 'order_confirmation',
      to: 'customer@example.com',
      subject: 'Order Confirmed - PR-1042',
      html: '<p>Thanks!</p>',
      context: { order_id: 'order-uuid-1', order_number: 'PR-1042' },
    })

    expect(insertCalls.length).toBe(1)
    expect(insertCalls[0].table).toBe('failed_emails')
    const payload = insertCalls[0].payload as Record<string, unknown>
    expect(payload.type).toBe('order_confirmation')
    expect(payload.to_email).toBe('customer@example.com')
    expect(payload.from_address).toBe('Pahadi Roots <noreply@pahadiroots.com>')
    expect(payload.subject).toBe('Order Confirmed - PR-1042')
    expect(payload.html).toBe('<p>Thanks!</p>')
    expect(payload.context).toEqual({ order_id: 'order-uuid-1', order_number: 'PR-1042' })
    expect(payload.status).toBe('pending')
    expect(payload.attempts).toBe(0)
    expect(payload.last_error).toContain('Resend is down')
  })

  it('honours a custom `from` override both on send and in the dead-letter row', async () => {
    mockSend.mockResolvedValue({ data: null, error: { name: 'application_error', message: 'down' } })

    await sendTransactionalEmail({
      type: 'contact_form',
      to: 'hello@pahadiroots.com',
      from: 'Pahadi Roots Contact <noreply@pahadiroots.com>',
      subject: 'Contact form: Test',
      html: '<p>Hi</p>',
    })

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Pahadi Roots Contact <noreply@pahadiroots.com>' }),
    )
    const payload = insertCalls[0].payload as Record<string, unknown>
    expect(payload.from_address).toBe('Pahadi Roots Contact <noreply@pahadiroots.com>')
  })

  it('never throws even when the DLQ insert itself fails — the email is reported as unsent, not crashed', async () => {
    mockSend.mockResolvedValue({ data: null, error: { name: 'application_error', message: 'down' } })
    insertShouldFail = true

    const result = await sendTransactionalEmail({
      type: 'order_confirmation', to: 'customer@example.com',
      subject: 'Order Confirmed', html: '<p>Thanks!</p>',
    })

    expect(result).toEqual(
      expect.objectContaining({ sent: false, deadLettered: false }),
    )
  })

  it('never throws even when the DLQ insert call itself throws (DB connection error, not just a resolved {error})', async () => {
    mockSend.mockResolvedValue({ data: null, error: { name: 'application_error', message: 'down' } })
    insertShouldThrow = true

    const result = await sendTransactionalEmail({
      type: 'order_confirmation', to: 'customer@example.com',
      subject: 'Order Confirmed', html: '<p>Thanks!</p>',
    })

    expect(result).toEqual(
      expect.objectContaining({ sent: false, deadLettered: false }),
    )
  })
})
