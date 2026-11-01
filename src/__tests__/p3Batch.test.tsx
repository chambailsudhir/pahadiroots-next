// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

const track = vi.fn()
let path = '/products'
vi.mock('next/navigation', () => ({ usePathname: () => path }))
vi.mock('@/lib/analytics/track', () => ({ trackPageView: (p: string) => track(p) }))
vi.mock('next/image', () => ({ default: (p: any) => React.createElement('img', { alt: p.alt, src: typeof p.src === 'string' ? p.src : '' }) }))
vi.mock('next/link', () => ({ default: ({ children, href, ...r }: any) => React.createElement('a', { href, ...r }, children) }))

import PageViewTracker from '@/components/analytics/PageViewTracker'
import Reveal from '@/components/story/Reveal'
import RegionStories from '@/components/story/RegionStories'

describe('PageViewTracker', () => {
  beforeEach(() => { track.mockClear(); path = '/products' })
  it('sends one page view per path, even if only the query string changes', () => {
    const { rerender } = render(<PageViewTracker />)
    rerender(<PageViewTracker />)
    expect(track).toHaveBeenCalledTimes(1)
    path = '/search'; rerender(<PageViewTracker />)
    expect(track).toHaveBeenCalledTimes(2)
    expect(track).toHaveBeenLastCalledWith('/search')
  })
})

describe('Reveal', () => {
  it('does not hide content that is already on screen (no flash after hydration)', () => {
    class IO { observe() {} disconnect() {} }
    ;(window as any).IntersectionObserver = IO
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as any
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 300, left: 0, right: 10, width: 10, height: 200, x: 0, y: 100, toJSON() {} } as DOMRect)
    const { container } = render(<Reveal>hello</Reveal>)
    expect((container.firstChild as HTMLElement).className).not.toMatch(/rvArm/)
    spy.mockReturnValue({ top: 5000, bottom: 5200, left: 0, right: 10, width: 10, height: 200, x: 0, y: 5000, toJSON() {} } as DOMRect)
    const { container: c2 } = render(<Reveal>below the fold</Reveal>)
    expect((c2.firstChild as HTMLElement).className).toMatch(/rvArm/)
    spy.mockRestore()
  })
})

describe('RegionStories tabs', () => {
  it('Home / End jump to the first / last tab', () => {
    render(<RegionStories regionNames={[]} />)
    const tabs = screen.getAllByRole('tab')
    fireEvent.keyDown(tabs[0], { key: 'End' })
    expect(screen.getAllByRole('tab').at(-1)!.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(screen.getAllByRole('tab').at(-1)!, { key: 'Home' })
    expect(screen.getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true')
  })
  it('each "Made here" item links to a search for that product, not one shared URL', () => {
    const { container } = render(<RegionStories regionNames={[]} />)
    const hrefs = [...container.querySelectorAll('ul li a')].map(a => a.getAttribute('href')).filter(h => h?.startsWith('/search'))
    expect(hrefs.length).toBeGreaterThan(0)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})
