// @vitest-environment jsdom
/**
 * NewsletterBar.test.tsx
 *
 * Component-level coverage for NewsletterBar.tsx — previously zero test
 * coverage, despite this being the component that made the original
 * "Get 5% Off Your First Order... check your inbox for your discount
 * code" promise that the P1 audit found was never fulfilled by the
 * backend (fixed in api/v1/actions/route.ts's `subscribe` action).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import NewsletterBar from '@/components/homepage/NewsletterBar'

describe('NewsletterBar', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not submit an invalid email', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<NewsletterBar />)
    fireEvent.change(screen.getByPlaceholderText('Your email address'), { target: { value: 'not-an-email' } })
    fireEvent.click(screen.getByText('Subscribe →'))

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('submits a valid email to the real subscribe action', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    render(<NewsletterBar />)
    fireEvent.change(screen.getByPlaceholderText('Your email address'), { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByText('Subscribe →'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/actions', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'subscribe', email: 'jane@example.com' }),
      }))
    })
  })

  it('shows the discount-code confirmation on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

    render(<NewsletterBar />)
    fireEvent.change(screen.getByPlaceholderText('Your email address'), { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByText('Subscribe →'))

    await waitFor(() => {
      expect(screen.getByText(/check your inbox for your discount code/i)).toBeTruthy()
    })
  })

  it('shows an error message when the request fails, not a silent no-op', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    render(<NewsletterBar />)
    fireEvent.change(screen.getByPlaceholderText('Your email address'), { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByText('Subscribe →'))

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeTruthy()
    })
  })

  it('shows an error message on a network failure too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    render(<NewsletterBar />)
    fireEvent.change(screen.getByPlaceholderText('Your email address'), { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByText('Subscribe →'))

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeTruthy()
    })
  })

  it('disables the submit button while the request is in flight', async () => {
    let resolveFetch: (v: { ok: boolean }) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise(res => { resolveFetch = res })))

    render(<NewsletterBar />)
    fireEvent.change(screen.getByPlaceholderText('Your email address'), { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByText('Subscribe →'))

    const btn = await screen.findByText('…')
    expect((btn as HTMLButtonElement).disabled).toBe(true)

    resolveFetch!({ ok: true })
    await waitFor(() => expect(screen.getByText(/check your inbox/i)).toBeTruthy())
  })

  // ── Added with the HOME-002 rebuild: accessibility + clearer feedback ──────────────────────────
  it('labels the email field for screen readers and exposes a polite live status region', () => {
    render(<NewsletterBar />)
    expect(screen.getByLabelText('Email address')).toBeTruthy()
    const live = document.querySelector('p[aria-live="polite"]')
    expect(live).not.toBeNull()
    expect(live!.getAttribute('role')).toBe('status')
  })

  it('tells the visitor when the email is invalid instead of silently doing nothing', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<NewsletterBar />)
    fireEvent.change(screen.getByPlaceholderText('Your email address'), { target: { value: 'nope' } })
    fireEvent.click(screen.getByText('Subscribe →'))
    expect(screen.getByText(/valid email address/i)).toBeTruthy()
    expect(screen.getByLabelText('Email address').getAttribute('aria-invalid')).toBe('true')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows a specific message when rate-limited (HTTP 429)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }))
    render(<NewsletterBar />)
    fireEvent.change(screen.getByPlaceholderText('Your email address'), { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByText('Subscribe →'))
    await waitFor(() => expect(screen.getByText(/too many attempts/i)).toBeTruthy())
  })

  it('does not fire a second request while one is already in flight (double-click safe)', async () => {
    let resolveFetch: (v: { ok: boolean }) => void
    const fetchMock = vi.fn(() => new Promise(res => { resolveFetch = res }))
    vi.stubGlobal('fetch', fetchMock)
    render(<NewsletterBar />)
    fireEvent.change(screen.getByPlaceholderText('Your email address'), { target: { value: 'jane@example.com' } })
    const form = screen.getByLabelText('Email address').closest('form')!
    fireEvent.submit(form); fireEvent.submit(form)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveFetch!({ ok: true })
    await waitFor(() => expect(screen.getByText(/check your inbox/i)).toBeTruthy())
  })
})
