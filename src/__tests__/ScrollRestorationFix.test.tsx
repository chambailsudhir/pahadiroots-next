// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import ScrollRestorationFix from '@/components/ui/ScrollRestorationFix'

// jsdom doesn't implement history.scrollRestoration at all (`'scrollRestoration'
// in window.history` is false), unlike every real browser — define it here so
// these tests actually exercise the component's logic instead of hitting its
// "not supported" early return.
beforeEach(() => {
  Object.defineProperty(window.history, 'scrollRestoration', {
    value: 'auto', writable: true, configurable: true,
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ScrollRestorationFix', () => {
  it('BUG FIX: sets history.scrollRestoration to "manual" so the browser stops silently restoring a remembered scroll offset on reload', () => {
    render(<ScrollRestorationFix />)
    expect(window.history.scrollRestoration).toBe('manual')
  })

  it('BUG FIX: forces the page back to the top on mount, since the browser can restore a remembered offset before this component even runs', () => {
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    render(<ScrollRestorationFix />)
    expect(scrollToSpy).toHaveBeenCalledWith(0, 0)
  })

  it('does not force-scroll to top when the URL has a hash (a genuine anchor link)', () => {
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    // jsdom allows assigning location.hash directly
    window.location.hash = '#some-section'
    render(<ScrollRestorationFix />)
    expect(scrollToSpy).not.toHaveBeenCalled()
    window.location.hash = ''
  })

  it('renders nothing visible', () => {
    const { container } = render(<ScrollRestorationFix />)
    expect(container.innerHTML).toBe('')
  })
})
