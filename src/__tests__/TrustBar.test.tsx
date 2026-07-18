// @vitest-environment jsdom
/**
 * TrustBar.test.tsx
 *
 * Component-level coverage for TrustBar.tsx — previously zero test
 * coverage. Pure presentational component (no client-side state), driven
 * entirely by site settings.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TrustBar from '@/components/homepage/TrustBar'
import type { SiteSettings } from '@/types'

function settings(overrides: Record<string, string> = {}): SiteSettings {
  return { ...overrides } as unknown as SiteSettings
}

describe('TrustBar', () => {
  it('renders the default 4 fallback items when no trust settings are configured', () => {
    render(<TrustBar settings={settings()} />)
    expect(screen.getByText('100% Natural')).toBeTruthy()
    expect(screen.getByText('Himalayan Sourced')).toBeTruthy()
    expect(screen.getByText('Fair Trade')).toBeTruthy()
    expect(screen.getByText('Free Shipping')).toBeTruthy()
  })

  it('free shipping fallback text uses the configured free_shipping_min', () => {
    render(<TrustBar settings={settings({ free_shipping_min: '499' })} />)
    expect(screen.getByText('On orders above ₹499')).toBeTruthy()
  })

  it('defaults free shipping text to ₹0 when unset (confirmed live DB value)', () => {
    render(<TrustBar settings={settings()} />)
    expect(screen.getByText('On orders above ₹0')).toBeTruthy()
  })

  it('renders configured trust items instead of the fallback when any are set', () => {
    render(<TrustBar settings={settings({
      trust_1_icon: '🔥', trust_1_title: 'Custom Trust', trust_1_sub: 'Custom sub text',
    })} />)
    expect(screen.getByText('Custom Trust')).toBeTruthy()
    expect(screen.getByText('Custom sub text')).toBeTruthy()
    // Configured items replace the fallback set entirely, not merge with it.
    expect(screen.queryByText('100% Natural')).toBeNull()
  })

  it('skips a configured item that is explicitly hidden', () => {
    render(<TrustBar settings={settings({
      trust_1_title: 'Visible Item',
      trust_2_title: 'Hidden Item', trust_2_hide: 'true',
    })} />)
    expect(screen.getByText('Visible Item')).toBeTruthy()
    expect(screen.queryByText('Hidden Item')).toBeNull()
  })

  it('skips a configured slot with no title even if not explicitly hidden', () => {
    render(<TrustBar settings={settings({
      trust_1_title: 'Only This One',
      trust_2_icon: '🎯', // icon set but no title — should be filtered out
    })} />)
    expect(screen.getByText('Only This One')).toBeTruthy()
    expect(screen.queryByText('🎯')).toBeNull()
  })
})
