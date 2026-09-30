// @vitest-environment jsdom
/**
 * WhySection.test.tsx
 *
 * "Our Promise" section. The old version printed live farmer/state stats
 * (stat_farmer_families / stat_himalayan_states) and hard claims such as
 * "certificate with every order". The redesigned section intentionally makes
 * only claims that are always true, so these tests lock in: the four
 * promises render, copy stays conservative, and the stats are NOT printed.
 */

import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
vi.mock('next/image', () => ({
  default: ({ fill, priority, ...props }: Record<string, unknown>) =>
    React.createElement('img', { ...props, alt: (props.alt as string) ?? '' }),
}))
import WhySection from '@/components/homepage/WhySection'
import type { SiteSettings } from '@/types'

function settings(overrides: Record<string, string> = {}): SiteSettings {
  return { ...overrides } as unknown as SiteSettings
}

describe('WhySection (Our Promise)', () => {
  it('renders the section heading and eyebrow chip', () => {
    render(<WhySection settings={settings()} />)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('From the Himalayas. With Nothing to Hide.')
    expect(screen.getByText('Our Promise')).toBeTruthy()
  })

  it('renders all 4 promises as an ordered list with labels and numbers', () => {
    const { container } = render(<WhySection settings={settings()} />)
    expect(container.querySelectorAll('ol > li').length).toBe(4)
    ;['Origin', 'Tradition', 'Transparency', 'People'].forEach(l => expect(screen.getByText(l)).toBeTruthy())
    ;['01', '02', '03', '04'].forEach(n => expect(screen.getByText(n)).toBeTruthy())
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBe(4)
  })

  it('renders one illustration per promise', () => {
    const { container } = render(<WhySection settings={settings()} />)
    expect(container.querySelectorAll('img').length).toBe(4)
  })

  it('keeps the transparency claim conservative (no "every batch" guarantee)', () => {
    const { container } = render(<WhySection settings={settings()} />)
    const text = container.textContent || ''
    expect(text).toContain('Where testing, sourcing or product information is available')
    expect(text).not.toMatch(/every batch/i)
    expect(text).not.toMatch(/certificate with every order/i)
  })

  it('no longer prints farmer/state statistics, even when the settings exist', () => {
    const { container } = render(
      <WhySection settings={settings({ stat_himalayan_states: '15', stat_farmer_families: '750' })} />
    )
    expect(container.textContent).not.toMatch(/Himalayan states/)
    expect(container.textContent).not.toMatch(/farming families/)
  })

  it('renders without a settings prop', () => {
    render(<WhySection />)
    expect(screen.getByText('Made the', { exact: false })).toBeTruthy()
  })
})
