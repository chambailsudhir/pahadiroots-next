// Controllable IntersectionObserver mock for jsdom (jsdom has no real
// implementation — `new IntersectionObserver(...)` throws
// "ReferenceError: IntersectionObserver is not defined" unless something
// defines it first). This is why MobileBottomNav.tsx's scroll-to-top
// button and AddToCartSection.tsx's mobile sticky bar — both of which use
// the real IntersectionObserver API — had zero test coverage despite
// having their own test files: any test that rendered them would have
// crashed on mount without this.
//
// Unlike a bare "return {observe: noop}" stub (which only stops the
// crash), this one captures every constructed instance and its callback
// so a test can actually DRIVE the intersection state (`fireIntersection`)
// and assert on what the component does in response — real coverage of
// the show/hide logic, not just "doesn't throw on mount".
import { vi } from 'vitest'

type IOEntry = { isIntersecting: boolean; boundingClientRect?: { top: number } }
type IOCallback = (entries: IOEntry[]) => void

export class MockIntersectionObserver {
  callback: IOCallback
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()

  constructor(callback: IOCallback) {
    this.callback = callback
    instances.push(this)
  }
}

export let instances: MockIntersectionObserver[] = []

/** Call in beforeEach so each test starts with a clean instance list. */
export function resetIntersectionObserverMock() {
  instances = []
  ;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    MockIntersectionObserver
}

/** Drive the most recently constructed observer's callback, as the real
 *  browser API would when the observed element's visibility changes.
 *  `boundingClientRectTop` lets tests exercise AddToCartSection's
 *  scrolled-past-vs-not-yet-scrolled-to distinction. */
export function fireIntersection(
  isIntersecting: boolean,
  boundingClientRectTop: number = isIntersecting ? 0 : -100,
  which: number = instances.length - 1,
) {
  instances[which]?.callback([{ isIntersecting, boundingClientRect: { top: boundingClientRectTop } }])
}
