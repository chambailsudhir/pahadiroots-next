// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import React from 'react'
import StrictRouteNav, { strictNavTarget } from '@/components/ui/StrictRouteNav'

const a = (href: string, extra: Record<string, string> = {}) => { const e = document.createElement('a'); e.href = href; Object.entries(extra).forEach(([k, v]) => e.setAttribute(k, v)); return e }
const O = 'http://localhost:3000'

describe('strictNavTarget', () => {
  it('picks internal links to checkout / account (keeping query and hash)', () => {
    expect(strictNavTarget(a('/checkout'), O)).toBe('/checkout')
    expect(strictNavTarget(a('/account/orders/5?x=1#top'), O)).toBe('/account/orders/5?x=1#top')
  })
  it('ignores other pages, look-alikes, other sites, new-tab and download links', () => {
    for (const h of ['/', '/products', '/accountant', '/checkout-help', 'https://evil.example/checkout']) expect(strictNavTarget(a(h), O)).toBeNull()
    expect(strictNavTarget(a('/checkout', { target: '_blank' }), O)).toBeNull()
    expect(strictNavTarget(a('/account', { download: '' }), O)).toBeNull()
    expect(strictNavTarget(null, O)).toBeNull()
  })
})

describe('StrictRouteNav click handling', () => {
  const assign = vi.fn()
  beforeEach(() => {
    vi.useFakeTimers(); assign.mockClear()
    Object.defineProperty(window, 'location', { configurable: true, value: { origin: O, pathname: '/products', assign } })
  })
  afterEach(() => { vi.useRealTimers() })

  function setup(href: string, onClick?: () => void) {
    const { container } = render(<><StrictRouteNav /><a href={href} onClick={onClick}>go</a></>)
    return container.querySelector('a')!
  }

  it('turns a click on /checkout into a full page load, after the link\'s own handler ran', () => {
    const own = vi.fn(); const link = setup('/checkout', own)
    const notPrevented = fireEvent.click(link)
    expect(notPrevented).toBe(false)           // default (soft navigation) cancelled
    expect(own).toHaveBeenCalled()             // analytics-style onClick still ran
    expect(assign).not.toHaveBeenCalled(); vi.runAllTimers()
    expect(assign).toHaveBeenCalledWith('/checkout')
  })

  it('leaves modified clicks, other pages and moves inside the same strict section alone', () => {
    const link = setup('/checkout')
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true)
    expect(fireEvent.click(setup('/products'))).toBe(true)
    Object.defineProperty(window, 'location', { configurable: true, value: { origin: O, pathname: '/account', assign } })
    expect(fireEvent.click(setup('/account/orders/1'))).toBe(true)     // already in the strict document
    vi.runAllTimers(); expect(assign).not.toHaveBeenCalled()
  })
})
