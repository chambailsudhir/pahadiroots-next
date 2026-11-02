/**
 * Account page orchestration (E1-5 hydration gate, E1-9 expired banner, E1-11 ?tab= following the URL).
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

let params = new URLSearchParams('')
vi.mock('next/navigation', () => ({
  useSearchParams: () => params,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => React.createElement('a', { href, ...r }, children) }))

const init = vi.fn()
let authState: any
vi.mock('@/app/account/hooks/useAuth', () => ({ useAuth: () => authState }))
vi.mock('@/app/account/hooks/useOrders', () => ({
  useOrders: () => ({ hasFetched: true, fetchOrders: vi.fn(), stats: null }),
}))
vi.mock('@/app/account/hooks/useProfile', () => ({
  useProfile: () => ({ initFromProfile: vi.fn(), syncFromProfile: vi.fn() }),
}))
vi.mock('@/store/uiStore', () => ({ useUIStore: () => ({ openAuth: vi.fn() }) }))
vi.mock('@/app/account/_components/Sidebar', () => ({ default: () => null }))
vi.mock('@/app/account/_sections/OrdersSection', () => ({ default: () => <div>ORDERS-TAB</div> }))
vi.mock('@/app/account/_sections/AddressSection', () => ({ default: () => <div>ADDR-TAB</div> }))
vi.mock('@/app/account/_sections/ProfileSection', () => ({ default: () => null }))
vi.mock('@/app/account/_sections/PasswordSection', () => ({ default: () => null }))
vi.mock('@/app/account/_sections/NotificationsSection', () => ({ default: () => null }))
vi.mock('@/app/account/_sections/DangerZoneSection', () => ({ default: () => null }))
vi.mock('@/app/account/_sections/LoyaltySection', () => ({ default: () => null }))

import AccountPage from '@/app/account/page'
import { useUserStore } from '@/store/userStore'

function auth(over: Record<string, unknown>) {
  return { init, retry: vi.fn(), logout: vi.fn(), markExpired: vi.fn(), updateLocalProfile: vi.fn(), loggingOut: false,
    authState: 'idle', loaded: false, loggedIn: false, expired: false, profile: null, authUser: null, ...over }
}

beforeEach(() => { init.mockClear(); params = new URLSearchParams(''); useUserStore.setState({ _hasHydrated: false }) })

describe('AccountPage', () => {
  it('does not run auth.init() before the persisted user store has hydrated', () => {
    authState = auth({})
    const { rerender } = render(<AccountPage />)
    expect(init).not.toHaveBeenCalled()
    React.act(() => { useUserStore.setState({ _hasHydrated: true }) })
    rerender(<AccountPage />)
    expect(init).toHaveBeenCalled()
  })

  it('shows the session-expired banner above the login wall', () => {
    useUserStore.setState({ _hasHydrated: true })
    authState = auth({ authState: 'expired', loaded: true, expired: true })
    render(<AccountPage />)
    expect(screen.getByText(/Your session has expired/)).toBeTruthy()
    expect(screen.getByText('Sign In to Continue')).toBeTruthy()
  })

  it('follows a later ?tab= change while already on /account', () => {
    useUserStore.setState({ _hasHydrated: true })
    authState = auth({ authState: 'authenticated', loaded: true, loggedIn: true, profile: { id: 1 } })
    const { rerender } = render(<AccountPage />)
    expect(screen.getByText('ORDERS-TAB')).toBeTruthy()
    params = new URLSearchParams('tab=addresses')
    rerender(<AccountPage />)
    expect(screen.getByText('ADDR-TAB')).toBeTruthy()
  })
})
