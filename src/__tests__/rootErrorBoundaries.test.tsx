// @vitest-environment jsdom
/**
 * Nov 2026 verification: the app had no root error.tsx / global-error.tsx, so errors outside the few routes with their own
 * boundary showed Next's unbranded fallback with no retry and no way home.
 */
import { describe, it, expect, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { render, screen } from '@testing-library/react'
import React from 'react'

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: any) => React.createElement('a', { href, ...rest }, children),
}))

describe('root error boundaries', () => {
  it('app/error.tsx: branded, "Try again" calls reset(), links home', async () => {
    const { default: RootError } = await import('@/app/error')
    const reset = vi.fn()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<RootError error={new Error('boom')} reset={reset} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reset).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Go Home').closest('a')?.getAttribute('href')).toBe('/')
    spy.mockRestore()
  })

  it('app/global-error.tsx renders its own <html><body>, a working "Try again" and a home link', async () => {
    const { default: GlobalError } = await import('@/app/global-error')
    const html = renderToStaticMarkup(<GlobalError error={new Error('boom')} reset={() => {}} />)
    expect(html.startsWith('<html')).toBe(true)
    expect(html).toContain('<body')
    expect(html).toContain('HimVeda by Pahadi Roots')
    expect(html).toContain('href="/"')

    // The button wiring (jsdom renders the nested <html>/<body> as plain elements; React warns about the nesting).
    const reset = vi.fn()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<GlobalError error={new Error('boom')} reset={reset} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reset).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
