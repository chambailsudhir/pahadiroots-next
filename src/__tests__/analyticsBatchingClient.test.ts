// @vitest-environment jsdom
/**
 * analyticsBatchingClient.test.ts — browser half of the Oct 2026 disk-IO fix: events are queued and sent as
 * one batch instead of one request per event.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({ consent: vi.fn(() => true) }))
vi.mock('@/lib/consent', () => ({ hasAnalyticsConsent: mocks.consent }))

describe('client track() — queue and flush', () => {
  let beacon: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.useFakeTimers(); vi.resetModules()
    beacon = vi.fn(() => true)
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true })
    mocks.consent.mockReturnValue(true)
  })
  afterEach(() => { vi.useRealTimers() })

  it('sends N page views as one beacon after 10s', async () => {
    const { trackPageView } = await import('@/lib/analytics/track')
    trackPageView('/'); trackPageView('/collections'); trackPageView('/products/a')
    expect(beacon).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)
    expect(beacon).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(await (beacon.mock.calls[0][1] as Blob).text())
    expect(sent.events).toHaveLength(3)
  })

  it('flushes immediately on purchase so it survives navigation', async () => {
    const { trackPageView, trackPurchase } = await import('@/lib/analytics/track')
    trackPageView('/order-success'); trackPurchase('o1', 100)
    expect(beacon).toHaveBeenCalledTimes(1)
  })

  it('sends nothing without analytics consent', async () => {
    mocks.consent.mockReturnValue(false)
    const { trackPageView } = await import('@/lib/analytics/track')
    trackPageView('/'); vi.advanceTimersByTime(20_000)
    expect(beacon).not.toHaveBeenCalled()
  })
})
