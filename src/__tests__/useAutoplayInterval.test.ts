// @vitest-environment jsdom
/**
 * useAutoplayInterval.test.ts
 *
 * Covers the P2 audit fix: HeroBanner.tsx and CategoryTiles.tsx both ran
 * autoplay intervals forever with no prefers-reduced-motion check and no
 * pause when the tab was backgrounded. useAutoplayInterval is the shared
 * fix both now rely on (HeroBanner directly; CategoryTiles reuses the
 * same two checks inline since its interval is embedded in a larger,
 * already-existing effect).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAutoplayInterval } from '@/hooks/useAutoplayInterval'

function mockMatchMedia(reducedMotion: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reducedMotion : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
}

describe('useAutoplayInterval', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockMatchMedia(false)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('calls the callback repeatedly on the given interval', () => {
    const cb = vi.fn()
    renderHook(() => useAutoplayInterval(cb, 1000))

    expect(cb).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(cb).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2000)
    expect(cb).toHaveBeenCalledTimes(3)
  })

  it('never starts the interval at all when prefers-reduced-motion is set', () => {
    mockMatchMedia(true)
    const cb = vi.fn()
    renderHook(() => useAutoplayInterval(cb, 1000))

    vi.advanceTimersByTime(5000)
    // This is the actual bug: before this fix, the interval ran
    // regardless of the user's OS-level reduced-motion preference.
    expect(cb).not.toHaveBeenCalled()
  })

  it('does not start the interval when enabled is false', () => {
    const cb = vi.fn()
    renderHook(() => useAutoplayInterval(cb, 1000, false))

    vi.advanceTimersByTime(5000)
    expect(cb).not.toHaveBeenCalled()
  })

  it('pauses while the tab is not visible and resumes when it is', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    const cb = vi.fn()
    renderHook(() => useAutoplayInterval(cb, 1000))

    vi.advanceTimersByTime(1000)
    expect(cb).toHaveBeenCalledTimes(1)

    // Simulate the tab being backgrounded.
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    vi.advanceTimersByTime(3000)
    // This is the actual bug: before this fix, the interval kept firing
    // (and battery/CPU kept burning) on a backgrounded tab.
    expect(cb).toHaveBeenCalledTimes(1)

    // Simulate the tab coming back into view.
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    vi.advanceTimersByTime(1000)
    expect(cb).toHaveBeenCalledTimes(2)
  })
})
