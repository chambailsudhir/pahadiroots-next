/**
 * profileFieldLeakage.security.test.ts
 *
 * SECURITY REGRESSION — confirmed live finding, not a hypothetical.
 *
 * syncCustomerProfile() fetches the customer row with `select=*` (needed
 * server-side to match by auth_user_id/phone/email and upsert). Multiple
 * routes were spreading that ENTIRE raw row directly into the client-facing
 * JSON response: /api/profile (GET) and six branches of /api/auth.
 *
 * This was low-risk while `customers` only held customer-authored fields.
 * The admin panel's CRM migration (supabase-migration-customer-crm-fields.sql,
 * in the pahadi-admin-main repo) added:
 *   - notes        free-text internal commentary written BY STAFF ABOUT
 *                  this customer (e.g. "difficult customer, watch for
 *                  chargebacks")
 *   - is_blocked   internal blocklist flag
 *   - tags         internal admin-facing labels
 *   - gstin/is_business  B2B classification
 *
 * Without a fix, a blocked customer's own account page would show them
 * `is_blocked: true` in the network tab, and any internal note a staff
 * member wrote about them would ship straight to their browser.
 *
 * Fix: toPublicProfile() in serverUtils.ts is now the single choke point
 * every route passes `profile` through before it reaches
 * NextResponse.json(...). These tests pin that down at both the unit level
 * (toPublicProfile itself) and the route level (the actual HTTP handlers),
 * so this class of bug cannot silently come back if a future route forgets
 * to use it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { toPublicProfile } from '@/lib/api/serverUtils'

const SENSITIVE_KEYS = ['notes', 'tags', 'is_blocked', 'gstin', 'is_business'] as const

const RAW_CUSTOMER_ROW = {
  id: 'cust-1',
  auth_user_id: 'auth-1',
  first_name: 'Asha',
  last_name: 'Devi',
  email: 'asha@x.com',
  phone: '9876543210',
  address_line1: 'MG Road',
  city: 'Delhi',
  state: 'Delhi',
  pincode: '110001',
  created_at: '2024-01-01T00:00:00.000Z',
  loyalty_points: 500,
  wishlist_items: ['p1', 'p2'],
  // The exact fields added by the CRM migration — must NEVER reach the client.
  notes: 'Called twice about a damaged order — flagged as high-maintenance.',
  tags: ['difficult', 'chargeback-risk'],
  is_blocked: true,
  gstin: '07AAAAA0000A1Z5',
  is_business: true,
}

describe('toPublicProfile (unit) — strips internal admin-only fields', () => {
  it('never includes notes, tags, is_blocked, gstin, or is_business', () => {
    const result = toPublicProfile(RAW_CUSTOMER_ROW) as Record<string, unknown>
    for (const key of SENSITIVE_KEYS) {
      expect(result).not.toHaveProperty(key)
    }
  })

  it('keeps every field the account UI actually needs', () => {
    const result = toPublicProfile(RAW_CUSTOMER_ROW) as Record<string, unknown>
    expect(result.first_name).toBe('Asha')
    expect(result.email).toBe('asha@x.com')
    expect(result.phone).toBe('9876543210')
    expect(result.city).toBe('Delhi')
    expect(result.loyalty_points).toBe(500)
    expect(result.wishlist_items).toEqual(['p1', 'p2'])
  })

  it('returns null for a null/undefined profile instead of throwing', () => {
    expect(toPublicProfile(null)).toBeNull()
    expect(toPublicProfile(undefined)).toBeNull()
  })

  it('does not choke on a profile missing some allowlisted fields', () => {
    expect(() => toPublicProfile({ id: 'x' })).not.toThrow()
  })
})

// ── Route-level integration: /api/profile GET ───────────────────────────────
const mocks = vi.hoisted(() => ({
  sbAuth: vi.fn(),
  sbAdmin: vi.fn(),
  getToken: vi.fn(),
  tryRefresh: vi.fn(),
  applyNewCookies: vi.fn(),
  checkRateLimit: vi.fn(() => true),
  checkCsrf: vi.fn(() => null),
  syncCustomerProfile: vi.fn(),
}))

// NOTE: syncCustomerProfile calls sbAdmin as a same-module internal
// reference — mocking sbAdmin's export does NOT intercept that internal
// call (classic ESM self-reference limitation), so — matching this
// codebase's own established pattern in ordersLookupRoute.test.ts — we mock
// syncCustomerProfile directly instead of trying to keep the real one
// running against a mocked sbAdmin. toPublicProfile stays REAL (via
// importActual) since that's the exact logic this test is proving.
vi.mock('@/lib/api/serverUtils', async () => {
  const actual: any = await vi.importActual('@/lib/api/serverUtils')
  return {
    ok: actual.ok,
    fail: actual.fail,
    toPublicProfile: actual.toPublicProfile,
    sbAuth: mocks.sbAuth,
    sbAdmin: mocks.sbAdmin,
    getToken: mocks.getToken,
    tryRefresh: mocks.tryRefresh,
    applyNewCookies: mocks.applyNewCookies,
    checkRateLimit: mocks.checkRateLimit,
    checkCsrf: mocks.checkCsrf,
    syncCustomerProfile: mocks.syncCustomerProfile,
  }
})

function makeRequest(url = 'https://pahadiroots.com/api/profile') {
  return new NextRequest(url, { headers: { cookie: 'sb-access-token=valid-token' } })
}

describe('GET /api/profile — route-level leak check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getToken.mockReturnValue('valid-token')
    mocks.sbAuth.mockResolvedValue({ id: 'auth-1', email: 'asha@x.com', phone: '9876543210' })
    mocks.syncCustomerProfile.mockResolvedValue(RAW_CUSTOMER_ROW)
    // saved_addresses join — empty, not the focus of this test
    mocks.sbAdmin.mockResolvedValue([])
  })

  it('never includes notes/tags/is_blocked/gstin/is_business in the JSON response', async () => {
    const { GET } = await import('@/app/api/profile/route')
    const res = await GET(makeRequest())
    const json = await res.json()

    expect(json.profile).toBeTruthy()
    for (const key of SENSITIVE_KEYS) {
      expect(json.profile).not.toHaveProperty(key)
    }
  })

  it('still returns the fields the account page actually renders', async () => {
    const { GET } = await import('@/app/api/profile/route')
    const res = await GET(makeRequest())
    const json = await res.json()

    expect(json.profile.first_name).toBe('Asha')
    expect(json.profile.email).toBe('asha@x.com')
    expect(json.profile.city).toBe('Delhi')
  })
})
