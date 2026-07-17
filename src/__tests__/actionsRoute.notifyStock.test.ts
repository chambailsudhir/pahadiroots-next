/**
 * actionsRoute.notifyStock.test.ts
 *
 * Direct route-level tests for POST /api/v1/actions, covering two P1
 * audit fixes with zero prior test coverage:
 *
 *   1. notify_stock — ProductCard's "Notify Me" button previously had no
 *      backend at all. This is the real capture behind it now, writing
 *      to stock_notifications (db_migration_v10).
 *   2. subscribe — the pre-existing (not introduced by this audit)
 *      `subscribers` upsert was sending a `subscribed_at` column that
 *      doesn't exist on the real table (confirmed via live schema
 *      introspection) and never checked the result for an error, so
 *      failures were silent. Now checked and surfaced as a 500.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockUpsert = vi.fn()
const mockFrom   = vi.fn(() => ({ upsert: mockUpsert }))

vi.mock('@/lib/supabase', () => ({
  getServiceClient: vi.fn(() => ({ from: mockFrom })),
}))
vi.mock('@/lib/server/email', () => ({
  sendTransactionalEmail: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from '@/app/api/v1/actions/route'

let ipCounter = 0
function req(body: Record<string, unknown>) {
  ipCounter++
  return new NextRequest('http://localhost/api/v1/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${ipCounter}` },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/actions — notify_stock (P1 fix)', () => {
  beforeEach(() => {
    mockUpsert.mockReset()
    mockFrom.mockClear()
  })

  it('writes a real row to stock_notifications instead of doing nothing', async () => {
    mockUpsert.mockResolvedValue({ error: null })

    const res = await POST(req({ action: 'notify_stock', email: 'jane@example.com', product_id: 101 }))
    const json = await res.json()

    expect(json).toEqual({ success: true })
    expect(mockFrom).toHaveBeenCalledWith('stock_notifications')
    expect(mockUpsert).toHaveBeenCalledWith(
      { product_id: 101, email: 'jane@example.com' },
      { onConflict: 'product_id,email', ignoreDuplicates: true },
    )
  })

  it('rejects an invalid email instead of writing garbage to the table', async () => {
    const res = await POST(req({ action: 'notify_stock', email: 'not-an-email', product_id: 101 }))
    expect(res.status).toBe(400)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('rejects a missing product_id', async () => {
    const res = await POST(req({ action: 'notify_stock', email: 'jane@example.com' }))
    expect(res.status).toBe(400)
  })

  it('returns a 500 (not a false success) when the DB write fails', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'db down' } })

    const res = await POST(req({ action: 'notify_stock', email: 'jane@example.com', product_id: 101 }))
    expect(res.status).toBe(500)
  })
})

describe('POST /api/v1/actions — subscribe (schema-drift bug found + fixed)', () => {
  beforeEach(() => {
    mockUpsert.mockReset()
    mockFrom.mockClear()
  })

  it('no longer sends the non-existent subscribed_at column', async () => {
    mockUpsert.mockResolvedValue({ error: null })

    await POST(req({ action: 'subscribe', email: 'jane@example.com' }))

    expect(mockFrom).toHaveBeenCalledWith('subscribers')
    const [payload] = mockUpsert.mock.calls[0]
    // This is the actual bug: the old upsert sent `subscribed_at`, a
    // column that does not exist on the real table (confirmed via
    // information_schema.columns) — every signup may have been silently
    // erroring. Real columns only: email, name, is_active.
    expect(payload).not.toHaveProperty('subscribed_at')
    expect(payload).toEqual({ email: 'jane@example.com', name: null, is_active: true })
  })

  it('surfaces a subscribers-table error as a 500 instead of silently swallowing it', async () => {
    // First call = subscribers upsert (fails), no second call should
    // matter since we return early.
    mockUpsert.mockResolvedValueOnce({ error: { message: 'column does not exist' } })

    const res = await POST(req({ action: 'subscribe', email: 'jane@example.com' }))
    // This is the actual bug: previously the result of this upsert was
    // never checked at all — a DB error here was invisible to both the
    // caller and any logs.
    expect(res.status).toBe(500)
  })

  it('still returns success on the happy path', async () => {
    mockUpsert.mockResolvedValue({ error: null })

    const res = await POST(req({ action: 'subscribe', email: 'jane@example.com' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ success: true })
  })
})
