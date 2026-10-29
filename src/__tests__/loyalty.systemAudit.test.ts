/**
 * loyalty.systemAudit.test.ts — System audit (Oct 2026), LOY-001/LOY-002.
 * awardLoyaltyPoints: a malformed setting produced NaN points (sent as null), and an HTTP error from the RPC was silent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
const captureError = vi.fn()
vi.mock('@/lib/logger', () => ({ captureError: (...a: unknown[]) => captureError(...a), logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { awardLoyaltyPoints, redeemLoyaltyPoints } from '@/lib/server/loyalty'

const fetchMock = vi.fn()
beforeEach(() => { captureError.mockReset(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
const sent = () => JSON.parse(fetchMock.mock.calls[0][1].body)

describe('awardLoyaltyPoints', () => {
  it('awards floor(total × rate) points', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
    await awardLoyaltyPoints(1, 2, 499.9, { loyalty_points_per_rupee: '0.1' })
    expect(sent().p_points).toBe(49)
  })
  it.each(['abc', '-3', 'NaN', 'Infinity'])('malformed / negative rate %j falls back to 1 point per rupee (never NaN/null)', async (bad) => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
    await awardLoyaltyPoints(1, 2, 300, { loyalty_points_per_rupee: bad })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sent().p_points).toBe(300)
  })
  it('a NaN order total awards nothing and makes no call', async () => {
    await awardLoyaltyPoints(1, 2, NaN, {})
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rate 0 or loyalty disabled → no call', async () => {
    await awardLoyaltyPoints(1, 2, 500, { loyalty_points_per_rupee: '0' })
    await awardLoyaltyPoints(1, 2, 500, { loyalty_enabled: 'false' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('an HTTP error from the database call raises an ALERT (it used to be silent)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    await awardLoyaltyPoints(1, 2, 500, {})
    expect(captureError).toHaveBeenCalledTimes(1)
    expect(captureError.mock.calls[0][1]).toMatchObject({ alert: true, action: 'loyalty.awardLoyaltyPoints', order_id: '2' })
  })
  it('a network failure still alerts and never throws into the order flow', async () => {
    fetchMock.mockRejectedValue(new Error('boom'))
    await expect(awardLoyaltyPoints(1, 2, 500, {})).resolves.toBeUndefined()
    expect(captureError).toHaveBeenCalledTimes(1)
  })
  it('a successful call does not alert', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
    await awardLoyaltyPoints(1, 2, 500, {})
    expect(captureError).not.toHaveBeenCalled()
  })
})

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
