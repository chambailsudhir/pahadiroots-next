'use client'

import { useEffect, useRef } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// hooks/useAutoplayInterval.ts
//
// BUG FIX (P2, homepage audit): both HeroBanner.tsx (4.5s interval) and
// CategoryTiles.tsx (2.5s interval) auto-advanced forever with no
// `prefers-reduced-motion` check and no pause when the browser tab was
// backgrounded — wasting CPU/battery on an invisible tab, and ignoring an
// explicit user accessibility preference (WCAG 2.2.2 expects a way to
// pause auto-advancing content; respecting the OS-level reduced-motion
// setting is the least invasive way to do that for users who've already
// told their system they want it).
//
// One shared hook instead of duplicating this fix in both files — an
// autoplay carousel added later gets this behavior for free instead of
// needing the same fix written a third time.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calls `callback` every `intervalMs`, except:
 *   - not at all, if the user has `prefers-reduced-motion: reduce` set
 *   - paused while `document.visibilityState !== 'visible'` (backgrounded tab)
 *   - paused while `enabled` is false (e.g. a hover/touch pause flag)
 *
 * `enabled` and `intervalMs` may change between renders; the effect
 * re-evaluates on every change without needing `callback` to be memoized
 * (the latest callback is read via a ref so it's always current).
 */
export function useAutoplayInterval(callback: () => void, intervalMs: number, enabled: boolean = true) {
  const callbackRef = useRef(callback)
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined') return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) return

    let iv: ReturnType<typeof setInterval> | null = null

    function start() {
      if (iv) return
      iv = setInterval(() => callbackRef.current(), intervalMs)
    }
    function stop() {
      if (iv) { clearInterval(iv); iv = null }
    }

    if (document.visibilityState === 'visible') start()

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') start()
      else stop()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [intervalMs, enabled])
}
