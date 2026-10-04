/**
 * Navigation dead-end regression guard (cart).
 * Rewritten for S2: the progress nav is now the shared <CheckoutStepper />.
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
const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'cart', 'page.tsx'), 'utf8')

describe('cart page — a way back to the store inside the progress nav', () => {
  it('the page renders the shared stepper (cart skin) with the "Continue Shopping" link inside', () => {
    expect(src).toMatch(/<CheckoutStepper current="cart" skin="cart">[\s\S]*?<Link href="\/" className="cp-steps-back">[\s\S]*?<\/CheckoutStepper>/)
  })

  it('rendered: the back link sits inside the labelled nav', () => {
    render(React.createElement(
      CheckoutStepper, { current: 'cart', skin: 'cart' },
      React.createElement(Link, { href: '/', className: 'cp-steps-back' }, '← Continue Shopping'),
    ))
    const nav = screen.getByRole('navigation', { name: 'Checkout progress' })
    expect(within(nav).getByRole('link', { name: /continue shopping/i }).getAttribute('href')).toBe('/')
  })

  it('the page no longer hand-writes stepper markup (single source of truth)', () => {
    expect(src).not.toMatch(/className="cp-step\b/)
    expect(src).not.toMatch(/className="cp-steps-list"/)
  })
})
