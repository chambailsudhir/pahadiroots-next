// @vitest-environment jsdom
/**
 * resetPasswordPage.test.tsx
 *
 * AUDIT S2-001 — /reset-password did not exist; the recovery e-mail link
 * 404'd (and GoogleAuthHandler logged the visitor in instead). This page:
 *   • reads `#access_token=…&type=recovery`, keeps the token in memory only
 *     and strips the hash from the URL immediately
 *   • enforces the 8-character policy client-side before any request
 *   • POSTs reset_password with `Authorization: Bearer <token>` and
 *     credentials: 'omit' (the pr_token cookie must never be the identity)
 *   • persists the outcome so a reload after the hash was stripped still
 *     shows the result
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import React from 'react'

import ResetPasswordPage from '@/app/reset-password/page'
import {
  parseRecoveryHash, validateNewPassword, RESET_RESULT_KEY, RESET_PASSWORD_MIN_LENGTH,
} from '@/app/reset-password/resetPasswordHelpers'

const RECOVERY_HASH = '#access_token=RECOVERY_JWT&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery'

function setLocation(pathAndHash: string) {
  window.history.replaceState({}, '', pathAndHash)
}

describe('resetPasswordHelpers (pure)', () => {
  it('parseRecoveryHash accepts only type=recovery tokens', () => {
    expect(parseRecoveryHash(RECOVERY_HASH)).toEqual({ token: 'RECOVERY_JWT', error: null })
    expect(parseRecoveryHash('#access_token=LOGIN_JWT&token_type=bearer')).toEqual({ token: null, error: null })
    expect(parseRecoveryHash('')).toEqual({ token: null, error: null })
  })

  it('parseRecoveryHash surfaces Supabase error hashes (expired link)', () => {
    const r = parseRecoveryHash('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
    expect(r.token).toBeNull()
    expect(r.error).toBe('Email link is invalid or has expired')
  })

  it('validateNewPassword enforces the 8-char floor and confirmation', () => {
    expect(validateNewPassword('1234567', '1234567')).toMatch(/at least 8/)
    expect(validateNewPassword('12345678', '12345679')).toMatch(/do not match/)
    expect(validateNewPassword('x'.repeat(129), 'x'.repeat(129))).toMatch(/too long/)
    expect(validateNewPassword('12345678', '12345678')).toBeNull()
    expect(RESET_PASSWORD_MIN_LENGTH).toBe(8)
  })
})

describe('<ResetPasswordPage />', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    setLocation('/')
  })

  it('reads the recovery hash, strips it from the URL and shows the form', async () => {
    setLocation('/reset-password' + RECOVERY_HASH)
    render(<ResetPasswordPage />)

    expect(await screen.findByLabelText('New password')).toBeTruthy()
    // Token must not linger in the URL (history / referrer / analytics).
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/reset-password')
  })

  it('shows "invalid link" when there is no recovery token and no persisted result', async () => {
    setLocation('/reset-password')
    render(<ResetPasswordPage />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/invalid or has expired/i)
    expect(screen.queryByLabelText('New password')).toBeNull()
  })

  it('treats a non-recovery login hash as an invalid link (never resets with a login token)', async () => {
    setLocation('/reset-password#access_token=LOGIN_JWT&token_type=bearer')
    render(<ResetPasswordPage />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByLabelText('New password')).toBeNull()
  })

  it('shows the Supabase error text for an expired link', async () => {
    setLocation('/reset-password#error=access_denied&error_description=Email+link+is+invalid+or+has+expired')
    render(<ResetPasswordPage />)
    expect((await screen.findByRole('alert')).textContent).toContain('Email link is invalid or has expired')
  })

  it('rejects a password shorter than 8 characters without calling the API', async () => {
    setLocation('/reset-password' + RECOVERY_HASH)
    render(<ResetPasswordPage />)
    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'short1' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'short1' } })
    fireEvent.click(screen.getByRole('button', { name: /set new password/i }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/at least 8 characters/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects mismatched confirmation without calling the API', async () => {
    setLocation('/reset-password' + RECOVERY_HASH)
    render(<ResetPasswordPage />)
    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'correct-horse-9' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'correct-horse-8' } })
    fireEvent.click(screen.getByRole('button', { name: /set new password/i }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/do not match/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts reset_password with the recovery bearer, WITHOUT cookies, and persists success', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) })
    setLocation('/reset-password' + RECOVERY_HASH)
    render(<ResetPasswordPage />)

    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'correct-horse-9' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'correct-horse-9' } })
    fireEvent.click(screen.getByRole('button', { name: /set new password/i }))

    expect((await screen.findByRole('status')).textContent).toMatch(/password has been updated/i)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth')
    expect(init.method).toBe('POST')
    // The identity is the recovery token — never the pr_token session cookie.
    expect(init.headers.Authorization).toBe('Bearer RECOVERY_JWT')
    expect(init.credentials).toBe('omit')
    expect(JSON.parse(init.body)).toEqual({ action: 'reset_password', password: 'correct-horse-9' })

    expect(sessionStorage.getItem(RESET_RESULT_KEY)).toBe('success')
    // Form is gone — the token has been dropped from memory.
    expect(screen.queryByLabelText('New password')).toBeNull()
  })

  it('shows the API error and keeps the form when the server rejects the reset', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Token has expired' }) })
    setLocation('/reset-password' + RECOVERY_HASH)
    render(<ResetPasswordPage />)

    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'correct-horse-9' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'correct-horse-9' } })
    fireEvent.click(screen.getByRole('button', { name: /set new password/i }))

    expect((await screen.findByRole('alert')).textContent).toContain('Token has expired')
    expect(sessionStorage.getItem(RESET_RESULT_KEY)).toBeNull()
    await waitFor(() => expect(screen.getByLabelText('New password')).toBeTruthy())
  })

  it('shows the persisted success result after a reload (hash already stripped)', async () => {
    sessionStorage.setItem(RESET_RESULT_KEY, 'success')
    setLocation('/reset-password')
    render(<ResetPasswordPage />)
    expect((await screen.findByRole('status')).textContent).toMatch(/password has been updated/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
