// @vitest-environment jsdom
/**
 * mobileMenuRegions.test.ts
 *
 * Covers bug #21: MobileMenu's "By Region" section showed only the first 8
 * of 12 states (alphabetical) with no way to reach the remaining 4 — unlike
 * the desktop MegaMenu, which has a "View All Regions" link. Added the same
 * link to MobileMenu, shown only when there are more states than fit.
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useUIStore } from '@/store/uiStore'

vi.mock('@/lib/supabase', () => ({
  supabase:         {},
  getServiceClient: () => ({}),
}))

// Imported after the mock above so getSiteSettings.ts (transitively pulled
// in by MobileMenu for isEnabled()) doesn't try to create a real Supabase
// client at module load time.
const { default: MobileMenu } = await import('@/components/layout/MobileMenu')

function makeStates(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, slug: `s${i}`, name: `State ${i}`, is_active: true,
  })) as any
}

const SETTINGS = { site_name: 'HimVeda by Pahadi Roots' } as any

describe('MobileMenu — By Region section', () => {
  it('bug #21 — shows a "View All Regions" link when there are more than 8 states', () => {
    useUIStore.setState({ isMobileMenuOpen: true } as any)
    render(React.createElement(MobileMenu, { settings: SETTINGS, states: makeStates(12) }))

    const viewAll = screen.getByRole('link', { name: /view all regions/i })
    expect(viewAll.getAttribute('href')).toBe('/regions')

    // Only the first 8 are listed individually.
    expect(screen.getByText(/State 0/)).toBeTruthy()
    expect(screen.getByText(/State 7/)).toBeTruthy()
    expect(screen.queryByText(/State 8/)).toBeNull()
  })

  it('does not show the "View All Regions" link when 8 or fewer states exist (nothing to hide)', () => {
    useUIStore.setState({ isMobileMenuOpen: true } as any)
    render(React.createElement(MobileMenu, { settings: SETTINGS, states: makeStates(5) }))

    expect(screen.queryByRole('link', { name: /view all regions/i })).toBeNull()
  })
})
