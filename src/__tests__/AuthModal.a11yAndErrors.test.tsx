// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
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

function htmlResponse(status: number) {
  return Promise.resolve(new Response('<!DOCTYPE html><html>Bad gateway</html>', { status, headers: { 'Content-Type': 'text/html' } }))
}

describe('AuthModal — robustness and accessibility', () => {
  beforeEach(() => {
    useUIStore.setState({ isAuthOpen: true })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('shows a generic message (not the JSON parser error) when login gets an HTML 502', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => htmlResponse(502))
    render(<AuthModal />)
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Login' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Service temporarily unavailable, please try again')
    expect(alert.textContent).not.toMatch(/DOCTYPE|JSON/)
  })

  it('shows the generic message for forgot-password on an HTML 504', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => htmlResponse(504))
    render(<AuthModal />)
    fireEvent.click(screen.getByText('Forgot Password?'))
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'a@b.co' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/temporarily unavailable/)
  })

  it('clears the success banner when the tab is switched by the user', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })))
    render(<AuthModal />)
    fireEvent.click(screen.getAllByText('Sign Up')[0])
    fireEvent.change(screen.getByLabelText('First Name *'), { target: { value: 'Ravi' } })
    fireEvent.change(screen.getByLabelText('Email Address *'), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByLabelText('Password *'), { target: { value: 'Abcdef1!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))
    await screen.findByText(/Account created/)
    fireEvent.click(screen.getByRole('tab', { name: /Email/ }))
    expect(screen.queryByText(/Account created/)).toBeNull()
  })

  it('focuses a field on the sign-up view, makes the page inert and restores focus to the opener', async () => {
    vi.useFakeTimers()
    useUIStore.setState({ isAuthOpen: false })
    const { container } = render(
      <div>
        <main id="page"><button id="opener">Sign in</button></main>
        <AuthModal />
      </div>,
    )
    const opener = container.querySelector('#opener') as HTMLButtonElement
    opener.focus()
    act(() => { useUIStore.setState({ isAuthOpen: true }) })
    fireEvent.click(screen.getAllByText('Sign Up')[0])
    // reopen on the signup view so the login-only email ref is absent at focus time
    act(() => { useUIStore.setState({ isAuthOpen: false }) })
    expect(document.activeElement).toBe(opener)
    opener.focus()
    act(() => { useUIStore.setState({ isAuthOpen: true }) })
    expect(container.querySelector('#page')!.hasAttribute('inert')).toBe(true)
    act(() => { vi.advanceTimersByTime(150) })
    expect(document.activeElement).toBeInstanceOf(HTMLInputElement)
    act(() => { useUIStore.setState({ isAuthOpen: false }) })
    expect(container.querySelector('#page')!.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it('drops the typed password when the dialog is closed without logging in', async () => {
    render(<AuthModal />)
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } })
    act(() => { useUIStore.setState({ isAuthOpen: false }) })
    act(() => { useUIStore.setState({ isAuthOpen: true }) })
    await waitFor(() => expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe(''))
  })

  // Last on purpose: a successful login schedules closeAuth() 700 ms later, which must not leak into other tests.
  it('keeps Login disabled after a successful login until the reload', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true, user: { id: '1', email: 'a@b.co' } }), { status: 200 })))
    render(<AuthModal />)
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Login' }))
    await screen.findByText(/Welcome back/)
    const btn = screen.getByRole('button', { name: /Logging in/ })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })
})
