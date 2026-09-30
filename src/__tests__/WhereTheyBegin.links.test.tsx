// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children?: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))
vi.mock('next/image', () => ({ default: () => null }))
vi.mock('@/components/story/Reveal', () => ({
  default: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
}))

import WhereTheyBegin from '@/components/story/WhereTheyBegin'

describe('WhereTheyBegin — each story CTA goes to the product collection it names', () => {
  it.each([
    [/Meet the two honeys/, '/collections/himalayan-honey'],
    [/See the ghee/, '/collections/himalayan-ghee'],
    [/Discover sea buckthorn/, '/collections/mountain-juices'],
  ])('%s → %s', (label, href) => {
    render(<WhereTheyBegin />)
    expect(screen.getByText(label).closest('a')?.getAttribute('href')).toBe(href)
  })
})
