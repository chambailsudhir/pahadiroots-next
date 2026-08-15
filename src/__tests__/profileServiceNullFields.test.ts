/**
 * profileServiceNullFields.test.ts
 *
 * Root-cause regression test for the live "Something went wrong / Could not
 * connect" full-page failure on /account, found via a browser console Zod
 * error: {code: "invalid_type", expected: "string", received: "null",
 * path: ["profile","last_name"]}.
 *
 * ProfileSchema's fields used `z.string().optional()`, which in Zod only
 * accepts a MISSING key (undefined) — NOT a JSON `null`. But /api/profile's
 * own data layer legitimately returns `null` for several of these on
 * ordinary accounts: syncCustomerProfile() in serverUtils.ts explicitly
 * writes `last_name: ... || null` for any single-word-name account (e.g.
 * Google OAuth with no surname captured), and phone/address fields are all
 * nullable DB columns that are simply empty until a customer fills them in.
 * None of that is malformed — it's the ordinary shape for a common,
 * perfectly valid account.
 *
 * Every one of those accounts hit safeParse failing, which (since it's not
 * a 401) useAuth's init() routed to authState 'failed' instead of 'guest' or
 * 'authenticated' — rendering the full-page error screen, on every load,
 * for as long as any of these fields stayed null. This is NOT the same bug
 * class as a network failure — the request succeeded (200), the data was
 * completely valid, and the client-side schema rejected it anyway.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProfileSchema, ProfileResponseSchema, fetchProfile } from '@/lib/services/profileService'

describe('ProfileSchema — accepts null (not just missing) for nullable DB columns', () => {
  it.each([
    'first_name', 'last_name', 'phone', 'email',
    'address_line1', 'city', 'state', 'postal_code', 'saved_addresses',
  ])('accepts null for %s', (field) => {
    const result = ProfileSchema.safeParse({ id: 'c1', [field]: null })
    expect(result.success).toBe(true)
  })

  it('the exact real-world shape that crashed production: last_name null, everything else present', () => {
    // This is the literal shape reported live — a real, valid account with
    // no last name on file (single-word name at signup).
    const result = ProfileSchema.safeParse({
      id: 'c1', first_name: 'Sudhir', last_name: null, phone: '9876543210',
      email: 'sudhir@example.com', address_line1: null, city: null,
      state: null, postal_code: null, saved_addresses: '[]',
    })
    expect(result.success).toBe(true)
  })

  it('still rejects genuinely wrong types (a real validation bug should still surface)', () => {
    const result = ProfileSchema.safeParse({ id: 'c1', first_name: 12345 })
    expect(result.success).toBe(false)
  })
})

describe('ProfileResponseSchema — full /api/profile response with null fields', () => {
  it('parses successfully when profile has null last_name/phone/address fields (the production case)', () => {
    const raw = {
      user: { id: 'auth-1', email: 'sudhir@example.com', phone: null },
      profile: {
        id: 'c1', first_name: 'Sudhir', last_name: null, phone: null,
        email: 'sudhir@example.com', address_line1: null, city: null,
        state: null, postal_code: null, saved_addresses: '[]',
      },
    }
    const result = ProfileResponseSchema.safeParse(raw)
    expect(result.success).toBe(true)
  })
})

describe('fetchProfile — end-to-end: a null-field response no longer throws', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves normally (does not throw ServiceError) for a real account with null last_name', async () => {
    const body = {
      user: { id: 'auth-1', email: 'sudhir@example.com' },
      profile: { id: 'c1', first_name: 'Sudhir', last_name: null, phone: null },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
    }))

    const result = await fetchProfile()
    expect(result.profile?.first_name).toBe('Sudhir')
    expect(result.profile?.last_name).toBeNull()
  })
})
