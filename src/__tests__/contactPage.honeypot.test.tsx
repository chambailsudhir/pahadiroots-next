// @vitest-environment jsdom
/** Nov 2026 verification: /contact had no honeypot and posted 1-character messages. */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

vi.mock('swr', () => ({ default: () => ({ data: {} }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }))

import ContactPage from '@/app/contact/page'

afterEach(() => vi.unstubAllGlobals())

describe('/contact anti-spam', () => {
  it('renders a hidden `website` honeypot out of the tab order and posts it with the form', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    vi.stubGlobal('fetch', f)
    const { container } = render(<ContactPage />)
    const hp = container.querySelector('input[name="website"]') as HTMLInputElement
    expect(hp).toBeTruthy()
    expect(hp.tabIndex).toBe(-1)
    expect(hp.closest('[aria-hidden="true"]')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Your Name'), { target: { value: 'Ravi' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ravi@example.com' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Do you ship to Pune?' } })
    fireEvent.submit(container.querySelector('form')!)
    await screen.findByText('Message received!')
    expect(JSON.parse(f.mock.calls[0][1].body)).toMatchObject({ action: 'contact', website: '' })
  })

  it('a message under 10 characters is refused in the browser, before any request', () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const { container } = render(<ContactPage />)
    fireEvent.change(screen.getByLabelText('Your Name'), { target: { value: 'Ravi' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ravi@example.com' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hi' } })
    fireEvent.submit(container.querySelector('form')!)
    expect(screen.getByRole('alert').textContent).toMatch(/at least 10 characters/)
    expect(f).not.toHaveBeenCalled()
  })
})
