// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import Icon, { AdminIcon, leadingEmojiIcon } from '@/components/ui/Icon'

describe('Icon', () => {
  it('is a decorative inline SVG that inherits colour and size', () => {
    const { container } = render(<Icon name="cart" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('fill')).toBe('none')
    expect(svg.getAttribute('width')).toBe('1.1em')
  })
  it('can be filled (saved heart)', () => {
    const { container } = render(<Icon name="heart" filled />)
    expect(container.querySelector('svg')!.getAttribute('fill')).toBe('currentColor')
  })
  it('every icon draws something', () => {
    for (const n of ['search', 'heart', 'user', 'sparkle', 'cart', 'eye', 'pin', 'mail', 'phone', 'globe', 'sun', 'moon', 'package', 'leaf', 'mountain', 'users', 'truck', 'shield', 'gift', 'flask', 'star', 'pause', 'play'] as const) {
      const { container } = render(<Icon name={n} />)
      expect(container.querySelector('svg')!.children.length).toBeGreaterThan(0)
    }
  })

  it('turns known owner-written emoji into icons and leaves unknown values alone', () => {
    const { container } = render(<><AdminIcon value="🏔️" /><span data-t>{<AdminIcon value="🦄" />}</span></>)
    expect(container.querySelectorAll('svg').length).toBe(1)
    expect(container.querySelector('[data-t]')!.textContent).toBe('🦄')
  })
  it('splits a leading emoji off ticker text', () => {
    expect(leadingEmojiIcon('🎁 Use code WELCOME50')).toEqual({ icon: 'gift', rest: 'Use code WELCOME50' })
    expect(leadingEmojiIcon('🚚 Free shipping')).toMatchObject({ icon: 'truck', rest: 'Free shipping' })
    expect(leadingEmojiIcon('🦄 Unknown')).toEqual({ icon: null, rest: 'Unknown' })
    expect(leadingEmojiIcon('Direct from farmers')).toEqual({ icon: null, rest: 'Direct from farmers' })
  })
})
