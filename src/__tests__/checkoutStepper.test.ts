/**
 * S1 / S2 — one shared stepper, state derived from `current`.
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import React from 'react'
import CheckoutStepper, { stepStates } from '@/components/checkout/CheckoutStepper'

afterEach(cleanup)
const r = (props: React.ComponentProps<typeof CheckoutStepper>) => render(React.createElement(CheckoutStepper, props))

describe('stepStates — the single rule', () => {
  it('cart → cart active, others upcoming', () => {
    expect(stepStates('cart')).toEqual({ cart: 'active', checkout: 'upcoming', confirmation: 'upcoming' })
  })
  it('checkout → cart done, checkout active', () => {
    expect(stepStates('checkout')).toEqual({ cart: 'done', checkout: 'active', confirmation: 'upcoming' })
  })
  it('confirmation → cart ✓, checkout ✓, confirmation active (the S1 expectation)', () => {
    expect(stepStates('confirmation')).toEqual({ cart: 'done', checkout: 'done', confirmation: 'active' })
  })
})

describe.each(['cart', 'checkout'] as const)('semantics are identical in the %s skin (S2)', (skin) => {
  it('is a labelled nav containing an ordered list of three steps', () => {
    r({ current: 'checkout', skin })
    const nav = screen.getByRole('navigation', { name: 'Checkout progress' })
    const list = within(nav).getByRole('list')
    expect(list.tagName).toBe('OL')
    expect(within(list).getAllByRole('listitem').filter(li => li.getAttribute('aria-hidden') !== 'true')).toHaveLength(3)
  })

  it.each(['cart', 'checkout', 'confirmation'] as const)('current=%s → exactly one aria-current="step", on the right label', (current) => {
    r({ current, skin })
    const cur = document.querySelectorAll('[aria-current="step"]')
    expect(cur).toHaveLength(1)
    expect(cur[0].textContent).toMatch(new RegExp(current, 'i'))
  })

  it('decorative connector lines are hidden from assistive tech', () => {
    r({ current: 'checkout', skin })
    document.querySelectorAll('.cp-step-line, .ck-crumb-line').forEach(el => expect(el.getAttribute('aria-hidden')).toBe('true'))
  })

  it('renders the page-supplied back link inside the nav', () => {
    r({ current: 'checkout', skin, children: React.createElement('a', { href: '/back', 'data-testid': 'back' }, '← Back') })
    expect(within(screen.getByRole('navigation', { name: 'Checkout progress' })).getByTestId('back')).toBeTruthy()
  })
})

describe('navigation (S3): only "Cart" is a link, and only while on Checkout', () => {
  it('checkout skin on checkout → Cart is a real link to /cart; Checkout and Confirmation are not links', () => {
    r({ current: 'checkout', skin: 'checkout' })
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('/cart')
    expect(links[0].textContent).toMatch(/cart/i)
    expect(links[0].className).toContain('ck-crumb--link')
  })
  it('confirmation → NO links at all (nothing to go back to after an order is placed)', () => {
    r({ current: 'confirmation', skin: 'checkout' })
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
  it('cart page → no step is a link', () => {
    r({ current: 'cart', skin: 'cart' })
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
})

describe('looks are preserved per skin (class contract the shared CSS targets)', () => {
  it('cart skin: cp-* classes, active/done modifiers, numbers (✓ when done)', () => {
    r({ current: 'checkout', skin: 'cart' })
    const steps = Array.from(document.querySelectorAll('.cp-step'))
    expect(steps.map(s => s.className)).toEqual(['cp-step cp-step-done', 'cp-step cp-step-active', 'cp-step'])
    expect(steps.map(s => s.querySelector('span')!.textContent)).toEqual(['✓', '2', '3'])
  })
  it('checkout skin: ck-crumb* classes, ✓ on done, numbers otherwise, done lines coloured', () => {
    r({ current: 'confirmation', skin: 'checkout' })
    const crumbs = Array.from(document.querySelectorAll('.ck-crumb'))
    expect(crumbs.map(c => c.className.replace(' ck-crumb--link', ''))).toEqual(['ck-crumb ck-crumb--done', 'ck-crumb ck-crumb--done', 'ck-crumb ck-crumb--active'])
    expect(Array.from(document.querySelectorAll('.ck-crumb-dot')).map(d => d.textContent)).toEqual(['✓', '✓', '3'])
    expect(Array.from(document.querySelectorAll('.ck-crumb-line')).map(l => l.className)).toEqual(['ck-crumb-line ck-crumb-line--done', 'ck-crumb-line ck-crumb-line--done'])
  })
  it('checkout skin on checkout: first line done, second not (matches the previous hand-written markup)', () => {
    r({ current: 'checkout', skin: 'checkout' })
    expect(Array.from(document.querySelectorAll('.ck-crumb-line')).map(l => l.className)).toEqual(['ck-crumb-line ck-crumb-line--done', 'ck-crumb-line'])
  })
  it('solo (no back link) centres the steps', () => {
    r({ current: 'confirmation', skin: 'checkout' })
    expect(document.querySelector('.ck-nav-inner')!.className).toContain('ck-nav-inner--solo')
  })
})
