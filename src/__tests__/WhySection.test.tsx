// @vitest-environment jsdom
/**
 * WhySection.test.tsx
 *
 * Component-level coverage for WhySection.tsx — previously zero test
 * coverage. Purely static (no props, no client-side state); the test is
 * a content-lock smoke test so a future accidental deletion of a pillar
 * is caught.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import WhySection from '@/components/homepage/WhySection'

describe('WhySection', () => {
  it('renders the section heading', () => {
    render(<WhySection />)
    expect(screen.getByText('Why 5 Pahadi Roots')).toBeTruthy()
  })

  it('renders all 4 pillars with their numbers', () => {
    render(<WhySection />)
    expect(screen.getByText('Lab Tested Purity')).toBeTruthy()
    expect(screen.getByText('Direct from Farmers')).toBeTruthy()
    expect(screen.getByText('Eco Packaging')).toBeTruthy()
    expect(screen.getByText('Give-Back Program')).toBeTruthy()
    expect(screen.getByText('01')).toBeTruthy()
    expect(screen.getByText('02')).toBeTruthy()
    expect(screen.getByText('03')).toBeTruthy()
    expect(screen.getByText('04')).toBeTruthy()
  })
})
