/**
 * loyalty.systemAudit.test.ts — System audit (Oct 2026), LOY-001/LOY-002.
 * awardLoyaltyPoints: a malformed setting produced NaN points (sent as null), and an HTTP error from the RPC was silent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
const captureError = vi.fn()
vi.mock('@/lib/logger', () => ({ captureError: (...a: unknown[]) => captureError(...a), logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { redeemLoyaltyPoints } from '@/lib/server/loyalty'

const fetchMock = vi.fn()
beforeEach(() => { captureError.mockReset(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
// awardLoyaltyPoints first reads the order status (orders audit #5) — the RPC call is the one with a body
const rpcCalls = () => fetchMock.mock.calls.filter(c => String(c[0]).includes('/rpc/'))
const sent = () => JSON.parse(rpcCalls()[0][1].body)

describe('redeemLoyaltyPoints', () => {
  it('true only when the database says true', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => true })
    expect(await redeemLoyaltyPoints(1, 2, 50)).toBe(true)
    fetchMock.mockResolvedValue({ ok: true, json: async () => false })
    expect(await redeemLoyaltyPoints(1, 2, 50)).toBe(false)
  })
  it('an HTTP error body is treated as not-redeemed', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: 'x' }) })
    expect(await redeemLoyaltyPoints(1, 2, 50)).toBe(false)
  })
  it('zero points is a no-op success', async () => {
    expect(await redeemLoyaltyPoints(1, 2, 0)).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('orders audit #5 / #3 — loyalty guards', () => {
  it('redeemLoyaltyPoints retries once after a timeout/transport error (idempotent RPC) and succeeds', async () => {
    fetchMock.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ ok: true, json: async () => true })
    expect(await redeemLoyaltyPoints(1, 2, 50)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('redeemLoyaltyPoints does NOT retry an explicit FALSE (insufficient balance)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => false })
    expect(await redeemLoyaltyPoints(1, 2, 50)).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('redeemLoyaltyPoints gives up (false + alert) when both attempts throw', async () => {
    fetchMock.mockRejectedValue(new Error('down'))
    expect(await redeemLoyaltyPoints(1, 2, 50)).toBe(false)
    expect(captureError).toHaveBeenCalledTimes(1)
  })
})
