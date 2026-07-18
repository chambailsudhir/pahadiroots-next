/**
 * orderReturnRoute.test.ts
 *
 * POST /api/orders/[id]/return — regression tests for the architecture fix
 * described in PAHADI_ROOTS_SESSION_REPORT.md §2.
 *
 * The route used to PATCH orders.order_status to values like
 * 'return_requested' and write orders.return_reason / return_requested_at —
 * none of which exist in the real schema (order_status is a 7-value enum
 * that never changes for a return; those two columns don't exist at all).
 * It now INSERTs into the dedicated `returns` table instead, matching
 * admin's real, working system.
 *
 * These tests were sanity-checked against the *previous* (broken)
 * implementation to confirm they actually fail without this fix — in
 * particular, "inserts into `returns`, never PATCHes orders" and
 * "idempotency is keyed off the returns table, not order_status" would
 * both have failed before this session's rewrite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  sbAdmin:             vi.fn(),
  sbAuth:              vi.fn(),
  getToken:            vi.fn(),
  tryRefresh:          vi.fn(),
  syncCustomerProfile: vi.fn(),
  applyNewCookies:     vi.fn(),
  checkCsrf:           vi.fn(),
}))

vi.mock('@/lib/api/serverUtils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    ok:   (data: unknown) => NextResponse.json(data),
    fail: (status: number, msg: string) => NextResponse.json({ error: msg }, { status }),
    sbAdmin:             mocks.sbAdmin,
    sbAuth:              mocks.sbAuth,
    getToken:            mocks.getToken,
    tryRefresh:          mocks.tryRefresh,
    syncCustomerProfile: mocks.syncCustomerProfile,
    applyNewCookies:     mocks.applyNewCookies,
    checkCsrf:           mocks.checkCsrf,
  }
})

const VALID_TOKEN = 'valid-token'

const PROFILE = { id: 'cust-1', first_name: 'Ramesh', last_name: 'Kumar' }

const DELIVERED_ORDER = {
  id:           501,
  order_status: 'delivered',
  delivered_at: new Date().toISOString(), // just delivered — inside 7-day window
  updated_at:   new Date().toISOString(),
  order_number: 'PR-2026-0501',
}

function makeRequest(id: string, body: object) {
  return {
    req: new NextRequest(`https://pahadiroots.com/api/orders/${id}/return`, {
      method:  'POST',
      headers: { 'content-type': 'application/json', origin: 'https://pahadiroots.com' },
      body:    JSON.stringify(body),
    }),
    params: Promise.resolve({ id }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkCsrf.mockReturnValue(null)
  mocks.getToken.mockReturnValue(VALID_TOKEN)
  mocks.tryRefresh.mockResolvedValue(null)
  mocks.sbAuth.mockResolvedValue({ id: 'auth-user-1' })
  mocks.syncCustomerProfile.mockResolvedValue(PROFILE)
})

describe('POST /api/orders/[id]/return — architecture fix', () => {
  it('never PATCHes orders — inserts into `returns` instead', async () => {
    mocks.sbAdmin.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path.includes('/rest/v1/orders?')) return [DELIVERED_ORDER]
      if (method === 'GET' && path.includes('/rest/v1/returns?')) return []
      if (method === 'POST' && path.includes('/rest/v1/returns')) return null
      throw new Error(`Unexpected sbAdmin call: ${method} ${path}`)
    })

    const { POST } = await import('@/app/api/orders/[id]/return/route')
    const { req, params } = makeRequest('501', { reason: 'damaged' })
    const res = await POST(req, { params })
    expect(res.status).toBe(200)

    // The critical assertion: no PATCH call was ever made to /rest/v1/orders.
    const patchToOrders = mocks.sbAdmin.mock.calls.find(
      ([method, path]) => method === 'PATCH' && String(path).includes('/rest/v1/orders'),
    )
    expect(patchToOrders).toBeUndefined()

    // And a POST to /rest/v1/returns was made with the right shape.
    const insertCall = mocks.sbAdmin.mock.calls.find(
      ([method, path]) => method === 'POST' && String(path).includes('/rest/v1/returns'),
    )
    expect(insertCall).toBeDefined()
    const [, , insertBody] = insertCall!
    expect(insertBody).toMatchObject({
      order_id:     DELIVERED_ORDER.id,
      order_number: DELIVERED_ORDER.order_number,
      reason:       'damaged',
      status:       'requested',
    })
    // orders.order_status / return_reason / return_requested_at must never
    // appear in the insert body — those columns don't exist.
    expect(insertBody).not.toHaveProperty('order_status')
    expect(insertBody).not.toHaveProperty('return_reason')
    expect(insertBody).not.toHaveProperty('return_requested_at')
  })

  it('stores the "Other" free-text explanation in `description`, not concatenated into `reason`', async () => {
    mocks.sbAdmin.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path.includes('/rest/v1/orders?')) return [DELIVERED_ORDER]
      if (method === 'GET' && path.includes('/rest/v1/returns?')) return []
      if (method === 'POST' && path.includes('/rest/v1/returns')) return null
      throw new Error(`Unexpected sbAdmin call: ${method} ${path}`)
    })

    const { POST } = await import('@/app/api/orders/[id]/return/route')
    const { req, params } = makeRequest('501', { reason: 'other', other_detail: 'Box arrived crushed' })
    await POST(req, { params })

    const insertCall = mocks.sbAdmin.mock.calls.find(
      ([method, path]) => method === 'POST' && String(path).includes('/rest/v1/returns'),
    )
    const [, , insertBody] = insertCall!
    expect(insertBody).toMatchObject({ reason: 'other', description: 'Box arrived crushed' })
  })

  it('409s when a non-rejected return already exists — checked against the `returns` table, not order_status', async () => {
    mocks.sbAdmin.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path.includes('/rest/v1/orders?')) return [DELIVERED_ORDER]
      if (method === 'GET' && path.includes('/rest/v1/returns?')) return [{ id: 1, status: 'approved' }]
      throw new Error(`Unexpected sbAdmin call: ${method} ${path}`)
    })

    const { POST } = await import('@/app/api/orders/[id]/return/route')
    const { req, params } = makeRequest('501', { reason: 'changed_mind' })
    const res = await POST(req, { params })
    expect(res.status).toBe(409)
  })

  it('allows a fresh request when the existing return was rejected', async () => {
    mocks.sbAdmin.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path.includes('/rest/v1/orders?')) return [DELIVERED_ORDER]
      if (method === 'GET' && path.includes('/rest/v1/returns?')) return [{ id: 1, status: 'rejected' }]
      if (method === 'POST' && path.includes('/rest/v1/returns')) return null
      throw new Error(`Unexpected sbAdmin call: ${method} ${path}`)
    })

    const { POST } = await import('@/app/api/orders/[id]/return/route')
    const { req, params } = makeRequest('501', { reason: 'changed_mind' })
    const res = await POST(req, { params })
    expect(res.status).toBe(200)
  })

  it('422s for a non-delivered order', async () => {
    mocks.sbAdmin.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path.includes('/rest/v1/orders?')) return [{ ...DELIVERED_ORDER, order_status: 'shipped' }]
      if (method === 'GET' && path.includes('/rest/v1/returns?')) return []
      throw new Error(`Unexpected sbAdmin call: ${method} ${path}`)
    })

    const { POST } = await import('@/app/api/orders/[id]/return/route')
    const { req, params } = makeRequest('501', { reason: 'changed_mind' })
    const res = await POST(req, { params })
    expect(res.status).toBe(422)
  })

  it('422s once the 7-day return window has closed', async () => {
    const oldDelivered = { ...DELIVERED_ORDER, delivered_at: new Date(Date.now() - 10 * 86_400_000).toISOString() }
    mocks.sbAdmin.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path.includes('/rest/v1/orders?')) return [oldDelivered]
      if (method === 'GET' && path.includes('/rest/v1/returns?')) return []
      throw new Error(`Unexpected sbAdmin call: ${method} ${path}`)
    })

    const { POST } = await import('@/app/api/orders/[id]/return/route')
    const { req, params } = makeRequest('501', { reason: 'changed_mind' })
    const res = await POST(req, { params })
    expect(res.status).toBe(422)
  })

  it('rejects the old free-text sentence vocabulary — only admin\'s real codes are valid', async () => {
    // CROSS-REPO FIX: reason used to be a full sentence like 'Damaged or
    // defective product'. Admin's real Returns page only recognises
    // lowercase codes (damaged, wrong_item, not_as_described, changed_mind,
    // missing_parts, other). Submitting the old sentence must now fail
    // validation rather than silently landing in the DB unrecognised by admin.
    const { POST } = await import('@/app/api/orders/[id]/return/route')
    const { req, params } = makeRequest('501', { reason: 'Damaged or defective product' })
    const res = await POST(req, { params })
    expect(res.status).toBe(400)
    expect(mocks.sbAdmin).not.toHaveBeenCalled()
  })

  it('400s for an invalid reason', async () => {
    const { POST } = await import('@/app/api/orders/[id]/return/route')
    const { req, params } = makeRequest('501', { reason: 'Not a real reason' })
    const res = await POST(req, { params })
    expect(res.status).toBe(400)
    expect(mocks.sbAdmin).not.toHaveBeenCalled()
  })

  it('404s when the order does not belong to the caller (IDOR guard)', async () => {
    mocks.sbAdmin.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path.includes('/rest/v1/orders?')) return []
      throw new Error(`Unexpected sbAdmin call: ${method} ${path}`)
    })

    const { POST } = await import('@/app/api/orders/[id]/return/route')
    const { req, params } = makeRequest('501', { reason: 'changed_mind' })
    const res = await POST(req, { params })
    expect(res.status).toBe(404)
  })
})
