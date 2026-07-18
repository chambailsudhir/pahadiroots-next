// @vitest-environment jsdom
/**
 * WhySection.test.tsx
 *
 * Component-level coverage for WhySection.tsx — previously zero test
 * coverage. Mostly static, but the P3 audit fix made the "states
 * covered" figure shared with HeroBanner.tsx/AnnouncementBar.tsx instead
 * of an independently hardcoded, conflicting number.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import WhySection from '@/components/homepage/WhySection'
import type { SiteSettings } from '@/types'

function settings(overrides: Record<string, string> = {}): SiteSettings {
  return { ...overrides } as unknown as SiteSettings
}

describe('WhySection', () => {
  it('renders the section heading', () => {
    render(<WhySection settings={settings()} />)
    expect(screen.getByText('Why 5 Pahadi Roots')).toBeTruthy()
  })

  it('renders all 4 pillars with their numbers', () => {
    render(<WhySection settings={settings()} />)
    expect(screen.getByText('Lab Tested Purity')).toBeTruthy()
    expect(screen.getByText('Direct from Farmers')).toBeTruthy()
    expect(screen.getByText('Eco Packaging')).toBeTruthy()
    expect(screen.getByText('Give-Back Program')).toBeTruthy()
    expect(screen.getByText('01')).toBeTruthy()
    expect(screen.getByText('02')).toBeTruthy()
    expect(screen.getByText('03')).toBeTruthy()
    expect(screen.getByText('04')).toBeTruthy()
  })

  it('uses the shared states_covered setting instead of a hardcoded number (P3 fix)', () => {
    render(<WhySection settings={settings({ states_covered: '15' })} />)
    expect(screen.getByText(/15 Himalayan states/)).toBeTruthy()
  })

  it('defaults to 10 states when unset, matching HeroBanner/AnnouncementBar', () => {
    render(<WhySection settings={settings()} />)
    expect(screen.getByText(/10 Himalayan states/)).toBeTruthy()
  })
})
