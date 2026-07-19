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
    expect(screen.getByText('Why HimVeda by Pahadi Roots')).toBeTruthy()
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

  it('uses the shared stat_himalayan_states setting instead of a hardcoded number', () => {
    render(<WhySection settings={settings({ stat_himalayan_states: '15' })} />)
    expect(screen.getByText(/15 Himalayan states/)).toBeTruthy()
  })

  it('defaults to 10 states when unset, matching HeroBanner/AnnouncementBar', () => {
    render(<WhySection settings={settings()} />)
    expect(screen.getByText(/10 Himalayan states/)).toBeTruthy()
  })

  it('uses the real stat_farmer_families setting instead of the old hardcoded "200+"', () => {
    // This is the actual bug: WhySection hardcoded "200+ farming
    // families" while HeroBanner said "500+" — both wrong. A live
    // screenshot of the admin panel confirmed the real value is 100.
    render(<WhySection settings={settings({ stat_farmer_families: '750' })} />)
    expect(screen.getByText(/750\+ farming families/)).toBeTruthy()
  })

  it('defaults the farmer count to 100, matching the confirmed live admin value', () => {
    render(<WhySection settings={settings()} />)
    expect(screen.getByText(/100\+ farming families/)).toBeTruthy()
  })
})
