// @vitest-environment jsdom
/**
 * HelpLauncher — the single Help entry point that replaced the separate WhatsApp button, the Pahadi_AI avatar and
 * back-to-top on phones (Nov 2026 redesign).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

let mockPathname = '/'
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname, useRouter: () => ({ push: vi.fn() }) }))

import { useUIStore } from '@/store/uiStore'
import { useUserStore } from '@/store/userStore'
import HelpLauncher, { HELP_MESSAGES, openAssistant } from '@/components/layout/HelpLauncher'

beforeEach(() => {
  mockPathname = '/'
  useUIStore.setState({ isHelpOpen: false, isCartOpen: false, isSearchOpen: false, isMobileMenuOpen: false, isAuthOpen: false })
  useUserStore.setState({ user: null } as any)
})
afterEach(() => { cleanup(); document.getElementById('pr-ai-fab')?.remove(); vi.useRealTimers() })

describe('HelpLauncher', () => {
  it('starts closed and opens the sheet from the Help button', () => {
    render(<HelpLauncher whatsappNumber="919899984895" />)
    const btn = screen.getByRole('button', { name: 'Help' })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(btn)
    expect(screen.getByRole('dialog', { name: 'How can we help?' })).toBeTruthy()
    expect(btn.getAttribute('aria-expanded')).toBe('true')
  })

  it('offers three pre-filled WhatsApp messages to the configured number', () => {
    useUIStore.setState({ isHelpOpen: true })
    render(<HelpLauncher whatsappNumber="919899984895" />)
    for (const m of HELP_MESSAGES) {
      const href = screen.getByRole('link', { name: new RegExp(m.label) }).getAttribute('href')!
      expect(href.startsWith('https://wa.me/919899984895?text=')).toBe(true)
      expect(decodeURIComponent(href.split('text=')[1])).toBe(m.text)
    }
  })

  it('hides WhatsApp options when no number is configured, but keeps the assistant and tracking', () => {
    useUIStore.setState({ isHelpOpen: true })
    render(<HelpLauncher whatsappNumber="" />)
    expect(document.querySelector('a[href^="https://wa.me/"]')).toBeNull()
    expect(screen.getByRole('button', { name: /Ask Pahadi_AI/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Track an order/ }).getAttribute('href')).toBe('/track')
  })

  it('closes on Escape and returns focus to Help', () => {
    render(<HelpLauncher whatsappNumber="919899984895" />)
    const btn = screen.getByRole('button', { name: 'Help' })
    fireEvent.click(btn)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useUIStore.getState().isHelpOpen).toBe(false)
    expect(document.activeElement).toBe(btn)
  })

  it('opening Help closes any other panel (one panel at a time)', () => {
    useUIStore.setState({ isCartOpen: true })
    useUIStore.getState().openHelp()
    expect(useUIStore.getState().isCartOpen).toBe(false)
    expect(useUIStore.getState().isHelpOpen).toBe(true)
  })

  it('marks routes without the bottom nav so the floating button shows on phones there', () => {
    mockPathname = '/checkout'
    const { container } = render(<HelpLauncher whatsappNumber="1" />)
    expect(container.querySelector('.help-root-always')).not.toBeNull()
    cleanup()
    mockPathname = '/products'
    const r = render(<HelpLauncher whatsappNumber="1" />)
    expect(r.container.querySelector('.help-root-always')).toBeNull()
  })
})

describe('openAssistant', () => {
  it('clicks the widget launcher on the next tick (so the opening click cannot immediately close the chat)', () => {
    vi.useFakeTimers()
    const fab = document.createElement('button'); fab.id = 'pr-ai-fab'; fab.setAttribute('aria-expanded', 'false')
    const onClick = vi.fn(); fab.addEventListener('click', onClick); document.body.appendChild(fab)
    openAssistant()
    expect(onClick).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('waits for the lazily loaded widget, then gives up and calls the fallback', () => {
    vi.useFakeTimers()
    const fallback = vi.fn()
    openAssistant(fallback)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it('does not toggle the chat closed if it is already open', () => {
    vi.useFakeTimers()
    const fab = document.createElement('button'); fab.id = 'pr-ai-fab'; fab.setAttribute('aria-expanded', 'true')
    const onClick = vi.fn(); fab.addEventListener('click', onClick); document.body.appendChild(fab)
    openAssistant()
    act(() => { vi.advanceTimersByTime(1) })
    expect(onClick).not.toHaveBeenCalled()
  })
})
