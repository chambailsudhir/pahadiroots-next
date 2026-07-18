// @vitest-environment jsdom
/**
 * AuthModal.QuickLinks.test.tsx
 *
 * Component-level coverage for the P1 audit fix: AuthModal's "Quick
 * Links" panel (My Orders, Wishlist, Coupons, Saved Addresses, Contact
 * Us) was styled exactly like clickable nav rows — cursor:pointer, hover
 * background, a '›' chevron — but every row was a plain <div> with zero
 * onClick or href. Fixed to real navigation, closing the modal on click.
 * "Coupons" was dropped rather than wired to a fake destination: no
 * coupons page exists anywhere in this app. Zero test coverage existed
 * for this component before this file.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

vi.mock('next/link', () => ({
  default: ({ children, href, onClick }: { children?: React.ReactNode; href: string; onClick?: () => void }) =>
    React.createElement('a', { href, onClick }, children),
}))
vi.mock('@/lib/profileCache', () => ({
  buildCacheEntry: vi.fn(),
  writeProfileCache: vi.fn(),
  prefetchProfileToCache: vi.fn(),
}))

import AuthModal from '@/components/auth/AuthModal'
import { useUIStore } from '@/store/uiStore'

describe('AuthModal — Quick Links (P1 fix)', () => {
  beforeEach(() => {
    useUIStore.setState({ isAuthOpen: true })
  })

  it('renders every quick link as a real navigable anchor with a real href', () => {
    render(<AuthModal />)

    const expected: Record<string, string> = {
      'My Orders':       '/account/orders',
      'Wishlist':        '/wishlist',
      'Saved Addresses': '/account/addresses',
      'Contact Us':      '/contact',
    }

    for (const [label, href] of Object.entries(expected)) {
      const link = screen.getByText(label).closest('a')
      // This is the actual bug: these used to be plain <div>s with no
      // href or onClick at all — styled to look clickable, doing nothing.
      expect(link).not.toBeNull()
      expect(link?.getAttribute('href')).toBe(href)
    }
  })

  it('does not link "Coupons" anywhere — no such page exists in this app', () => {
    render(<AuthModal />)
    // Verifying the deliberate removal, not an oversight: linking it to
    // /account or anywhere else would just trade one broken promise for
    // a different one.
    expect(screen.queryByText('Coupons')).toBeNull()
  })

  it('closes the modal when a quick link is clicked', () => {
    render(<AuthModal />)
    expect(useUIStore.getState().isAuthOpen).toBe(true)

    fireEvent.click(screen.getByText('My Orders'))

    expect(useUIStore.getState().isAuthOpen).toBe(false)
  })
})

describe('AuthModal — dynamic aria-label (P3 fix)', () => {
  beforeEach(() => {
    useUIStore.setState({ isAuthOpen: true })
  })

  it('labels itself "Sign in" on the default email tab', () => {
    render(<AuthModal />)
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Sign in to HimVeda by Pahadi Roots')
  })

  it('labels itself "Sign up" after switching to the Sign Up tab', () => {
    render(<AuthModal />)
    // This is the actual bug: the label used to stay "Sign in to..."
    // even after switching tabs.
    // "Sign Up" appears both as the top tab and the bottom switch-link —
    // the tab is the first match in DOM order.
    fireEvent.click(screen.getAllByText('Sign Up')[0])
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Sign up for HimVeda by Pahadi Roots')
  })

  it('labels itself "Reset your password" on the forgot-password view', () => {
    render(<AuthModal />)
    fireEvent.click(screen.getByText(/forgot password/i))
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Reset your password')
  })
})
