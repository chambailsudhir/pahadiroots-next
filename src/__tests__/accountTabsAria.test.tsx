/**
 * Account navigation = ONE accessible tabs pattern (desktop sidebar tablist + mobile tablist, one tabpanel).
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import React from 'react'
import fs from 'node:fs'
import path from 'node:path'

let params = new URLSearchParams('')
vi.mock('next/navigation', () => ({
  useSearchParams: () => params,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('next/link', () => ({ default: ({ href, children, prefetch: _p, ...r }: any) => React.createElement('a', { href, ...r }, children) }))
vi.mock('@/app/account/hooks/useAuth', () => ({
  useAuth: () => ({ init: vi.fn(), retry: vi.fn(), logout: vi.fn(), markExpired: vi.fn(), updateLocalProfile: vi.fn(), loggingOut: false,
    authState: 'authenticated', loaded: true, loggedIn: true, expired: false, profile: { id: 1, first_name: 'Asha' }, authUser: { email: 'a@b.c' } }),
}))
vi.mock('@/app/account/hooks/useOrders', () => ({
  useOrders: () => ({ hasFetched: true, fetchOrders: vi.fn(), stats: { total: 2, delivered: 1, active: 1, spent: 500, loyalty_points: 10 } }),
}))
vi.mock('@/app/account/hooks/useProfile', () => ({ useProfile: () => ({ initFromProfile: vi.fn(), syncFromProfile: vi.fn() }) }))
vi.mock('@/store/uiStore', () => ({ useUIStore: () => ({ openAuth: vi.fn() }) }))
vi.mock('@/app/account/_sections/OrdersSection', () => ({ default: () => null }))
vi.mock('@/app/account/_sections/AddressSection', () => ({ default: () => null }))
vi.mock('@/app/account/_sections/ProfileSection', () => ({ default: () => null }))
vi.mock('@/app/account/_sections/PasswordSection', () => ({ default: () => null }))
vi.mock('@/app/account/_sections/NotificationsSection', () => ({ default: () => null }))
vi.mock('@/app/account/_sections/DangerZoneSection', () => ({ default: () => null }))
vi.mock('@/app/account/_sections/LoyaltySection', () => ({ default: () => null }))

import AccountPage from '@/app/account/page'
import { useUserStore } from '@/store/userStore'

beforeEach(() => { params = new URLSearchParams(''); useUserStore.setState({ _hasHydrated: true }) })

const lists = () => screen.getAllByRole('tablist', { hidden: true })
const desktop = () => lists().find(l => l.getAttribute('aria-orientation') === 'vertical')!
const mobile  = () => lists().find(l => l.getAttribute('aria-orientation') === 'horizontal')!

describe('account tabs — roles and wiring', () => {
  it('has a vertical (sidebar) and a horizontal (mobile) tablist containing only tabs', () => {
    render(<AccountPage />)
    expect(lists()).toHaveLength(2)
    for (const l of lists()) {
      const kids = Array.from(l.children)
      expect(kids.length).toBeGreaterThan(0)
      expect(kids.every(k => k.getAttribute('role') === 'tab')).toBe(true)
      expect(within(l).queryByRole('link', { hidden: true })).toBeNull()
    }
    expect(within(desktop()).getAllByRole('tab', { hidden: true })).toHaveLength(7)
    expect(within(mobile()).getAllByRole('tab', { hidden: true })).toHaveLength(7)
  })

  it('keeps Wishlist (a link to another page) outside every tablist and drops aria-current', () => {
    render(<AccountPage />)
    const links = screen.getAllByRole('link', { name: /wishlist/i, hidden: true })
    expect(links.length).toBe(2)
    for (const a of links) {
      expect(a.getAttribute('href')).toBe('/wishlist')
      expect(a.closest('[role="tablist"]')).toBeNull()
    }
    expect(document.querySelector('[aria-current]')).toBeNull()
  })

  it('every tab aria-controls the single tabpanel, which is labelled by the selected tab; ids are unique', () => {
    render(<AccountPage />)
    const panel = screen.getByRole('tabpanel')
    expect(panel.id).toBeTruthy()
    for (const t of screen.getAllByRole('tab', { hidden: true })) expect(t.getAttribute('aria-controls')).toBe(panel.id)
    const label = document.getElementById(panel.getAttribute('aria-labelledby')!)!
    expect(label.getAttribute('role')).toBe('tab')
    expect(label.getAttribute('aria-selected')).toBe('true')
    const ids = Array.from(document.querySelectorAll('[id]')).map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses roving tabindex: only the selected tab is in the tab order', () => {
    render(<AccountPage />)
    for (const l of lists()) {
      const tabs = within(l).getAllByRole('tab', { hidden: true })
      expect(tabs.filter(t => t.tabIndex === 0)).toHaveLength(1)
      expect(tabs.find(t => t.getAttribute('aria-selected') === 'true')!.tabIndex).toBe(0)
    }
  })
})

describe('account tabs — keyboard', () => {
  it('mobile: ArrowRight / ArrowLeft / End / Home move focus, select and wrap', () => {
    render(<AccountPage />)
    const tabs = () => within(mobile()).getAllByRole('tab', { hidden: true })
    tabs()[0].focus()
    fireEvent.keyDown(tabs()[0], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabs()[1])
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true')
    expect(tabs()[1].tabIndex).toBe(0)
    expect(tabs()[0].tabIndex).toBe(-1)
    fireEvent.keyDown(tabs()[1], { key: 'ArrowLeft' })
    fireEvent.keyDown(tabs()[0], { key: 'ArrowLeft' })           // wraps to last
    expect(document.activeElement).toBe(tabs()[6])
    fireEvent.keyDown(tabs()[6], { key: 'Home' })
    expect(document.activeElement).toBe(tabs()[0])
    fireEvent.keyDown(tabs()[0], { key: 'End' })
    expect(document.activeElement).toBe(tabs()[6])
    expect(tabs()[6].getAttribute('aria-selected')).toBe('true')
    // the panel follows the selected (desktop) tab
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(desktop().querySelector('[aria-selected="true"]')!.id)
  })

  it('sidebar: ArrowDown / ArrowUp navigate; ArrowLeft / ArrowRight are ignored (vertical list)', () => {
    render(<AccountPage />)
    const tabs = () => within(desktop()).getAllByRole('tab', { hidden: true })
    tabs()[0].focus()
    fireEvent.keyDown(tabs()[0], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabs()[0])
    fireEvent.keyDown(tabs()[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(tabs()[1])
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tabs()[1], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(tabs()[0])
  })

  it('mouse click still selects a tab', () => {
    render(<AccountPage />)
    const t = within(mobile()).getByRole('tab', { name: 'Privacy', hidden: true })
    fireEvent.click(t)
    expect(t.getAttribute('aria-selected')).toBe('true')
  })
})

describe('account tabs — mobile CSS', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'src/app/account/styles/account.module.css'), 'utf8')
  it('labels are >= 11px, the bar scrolls sideways, tabs have a min-width and >= 44px height', () => {
    const tab = css.match(/\.mobTab\s*\{([^}]*)\}/)![1]
    expect(Number(tab.match(/font-size:\s*(\d+)px/)![1])).toBeGreaterThanOrEqual(11)
    expect(Number(tab.match(/min-height:\s*(\d+)px/)![1])).toBeGreaterThanOrEqual(44)
    expect(tab).toMatch(/min-width:\s*\d+px/)
    expect(css.match(/\.mobTabScroll\s*\{([^}]*)\}/)![1]).toMatch(/overflow-x:\s*auto/)
  })
})

describe('DangerZone wording', () => {
  it('describes erased vs retained data and no longer promises "anonymised order history"', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/app/account/_sections/DangerZoneSection.tsx'), 'utf8')
    expect(src).toMatch(/up to 6 years/)
    expect(src).toMatch(/recipient name and delivery address/)
    expect(src).toMatch(/delivered or cancelled first|completed first/)
    expect(src).toMatch(/become anonymous/)
    expect(src).not.toMatch(/Order history will be anonymised/)
  })
})
