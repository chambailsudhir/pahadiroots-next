/**
 * actionsRoute.abandonedCart.test.ts
 *
 * Regression test for a live-production bug: save_abandoned_cart's upsert
 * sent a `name` column that did not exist on the real `abandoned_carts`
 * table (confirmed via information_schema.columns), causing every call to
 * 500 with "Could not find the 'name' column of 'abandoned_carts' in the
 * schema cache" (17 occurrences in the 24h window it was caught in).
 *
 * Non-blocking to checkout (the error was swallowed client-side), but it
 * silently broke personalization in the admin Marketing tab's cart-recovery
 * messages (`Hi${cart.name ? ' ' + cart.name : ''}!`) — every recovery
 * WhatsApp/email sent since that feature shipped rendered as "Hi!" with
 * no name, because the column read back empty.
 *
 * Fix applied as db_migration_v11_abandoned_carts_name.sql (adds the
 * missing `name text` column) — no code change needed, the route already
 * sent the right shape. This test locks in that shape so a future schema
 * drift is caught here instead of live in production again.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (cb: () => void | Promise<void>) => { void cb() } }
})

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
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.1.${ipCounter}` },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/actions — save_abandoned_cart (schema-drift bug found + fixed)', () => {
  beforeEach(() => {
    mockUpsert.mockReset()
    mockFrom.mockClear()
  })

  it('sends name in the upsert payload matching the real (post-migration) table shape', async () => {
    mockUpsert.mockResolvedValue({ error: null })

    await POST(req({
      action:     'save_abandoned_cart',
      session_id: 'sess_abc123',
      email:      'jane@example.com',
      name:       'Jane Doe',
      items:      [{ product_id: 1, name: 'Shilajit', qty: 1, price: 999 }],
      cart_total: 999,
    }))

    expect(mockFrom).toHaveBeenCalledWith('abandoned_carts')
    const [payload] = mockUpsert.mock.calls[0]
    // Real columns only (confirmed via information_schema.columns post-migration):
    // id, customer_id, auth_user_id, email, phone, cart_items, cart_total,
    // reminder_sent, reminder_sent_at, converted, created_at, updated_at,
    // reminder_count, last_reminder_at, session_id, name.
    expect(payload).toEqual({
      session_id: 'sess_abc123',
      email:      'jane@example.com',
      phone:      null,
      name:       'Jane Doe',
      cart_items: [{ product_id: 1, name: 'Shilajit', qty: 1, price: 999 }],
      cart_total: 999,
      converted:  false,
      updated_at: expect.any(String),
    })
  })

  it('still succeeds when name is omitted', async () => {
    mockUpsert.mockResolvedValue({ error: null })

    const res = await POST(req({
      action:     'save_abandoned_cart',
      session_id: 'sess_def456',
      phone:      '9999999999',
      items:      [{ product_id: 1, name: 'Shilajit', qty: 1, price: 999 }],
      cart_total: 999,
    }))

    expect(res.status).toBe(200)
    const [payload] = mockUpsert.mock.calls[0]
    expect(payload.name).toBeNull()
  })

  it('surfaces an abandoned_carts upsert error as a 500 instead of silently swallowing it', async () => {
    mockUpsert.mockResolvedValue({ error: { message: "Could not find the 'name' column of 'abandoned_carts' in the schema cache" } })

    const res = await POST(req({
      action:     'save_abandoned_cart',
      session_id: 'sess_ghi789',
      email:      'jane@example.com',
      items:      [{ product_id: 1, name: 'Shilajit', qty: 1, price: 999 }],
      cart_total: 999,
    }))

    expect(res.status).toBe(500)
  })

  it('rejects a payload with neither email nor phone', async () => {
    const res = await POST(req({
      action:     'save_abandoned_cart',
      session_id: 'sess_jkl012',
      items:      [{ product_id: 1, name: 'Shilajit', qty: 1, price: 999 }],
      cart_total: 999,
    }))
    expect(res.status).toBe(400)
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})
