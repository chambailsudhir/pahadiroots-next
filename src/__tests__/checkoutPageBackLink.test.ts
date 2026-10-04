/**
 * Navigation dead-end regression guard (checkout).
 * Rewritten for S2: the stepper is now the shared <CheckoutStepper />, so this asserts the
 * RENDERED behaviour (and that the page really uses the shared component) instead of
 * regex-matching hand-written markup that no longer lives in the page.
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import React from 'react'
import { render, screen, within, cleanup } from '@testing-library/react'
import CheckoutStepper from '@/components/checkout/CheckoutStepper'
import Link from 'next/link'

afterEach(cleanup)
const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'checkout', 'CheckoutClient.tsx'), 'utf8')

describe('checkout page — a way back to the cart is always visible', () => {
  it('the page renders the shared stepper for the checkout step with its own "Back to Cart" link inside', () => {
    expect(src).toMatch(/<CheckoutStepper current="checkout" skin="checkout">[\s\S]*?<Link href="\/cart" className="ck-nav-back">[\s\S]*?<\/CheckoutStepper>/)
  })

  it('rendered: nav contains BOTH the explicit back link and the "Cart" step link, both to /cart', () => {
    render(React.createElement(
      CheckoutStepper, { current: 'checkout', skin: 'checkout' },
      React.createElement(Link, { href: '/cart', className: 'ck-nav-back' }, '← Back to Cart'),
    ))
    const nav = screen.getByRole('navigation', { name: 'Checkout progress' })
    const links = within(nav).getAllByRole('link')
    expect(links.map(l => l.getAttribute('href'))).toEqual(['/cart', '/cart'])
    expect(links.some(l => l.className.includes('ck-nav-back'))).toBe(true)
    expect(links.some(l => l.className.includes('ck-crumb ck-crumb--done ck-crumb--link'))).toBe(true)
  })

  it('the page no longer hand-writes stepper markup (single source of truth)', () => {
    expect(src).not.toMatch(/className="ck-crumb\b/)
    expect(src).not.toMatch(/className="ck-nav-crumbs"/)
  })
})
