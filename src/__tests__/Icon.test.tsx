// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import Icon from '@/components/ui/Icon'

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
    for (const n of ['search', 'heart', 'user', 'sparkle', 'cart', 'eye', 'pin', 'mail', 'phone', 'globe', 'sun', 'moon', 'package'] as const) {
      const { container } = render(<Icon name={n} />)
      expect(container.querySelector('svg')!.children.length).toBeGreaterThan(0)
    }
  })
})
