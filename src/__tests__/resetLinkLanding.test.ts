/**
 * Reset-link landing (owner report 2026-10-28): the e-mail link ended on the home page with
 * `#error=access_denied&error_code=otp_expired` because Supabase falls back to the Site URL when
 * `redirect_to` is not allow-listed. These cases pin where each landing is forwarded.
 */
import { describe, it, expect } from 'vitest'
import { recoveryLandingTarget, friendlyLinkError } from '@/app/reset-password/resetPasswordHelpers'

const EXPIRED = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb='
const TOKEN   = '#access_token=abc.def.ghi&refresh_token=r&type=recovery&expires_in=3600'

describe('recoveryLandingTarget', () => {
  it('forwards an expired / used link that landed on the home page to the reset page, hash intact', () => {
    expect(recoveryLandingTarget('/', EXPIRED)).toBe('/reset-password' + EXPIRED)
  })
  it('forwards a VALID recovery token that landed on the home page (redirect URL not allow-listed)', () => {
    expect(recoveryLandingTarget('/', TOKEN)).toBe('/reset-password' + TOKEN)
  })
  it('forwards a valid recovery token from any other page too', () => {
    expect(recoveryLandingTarget('/account', TOKEN)).toBe('/reset-password' + TOKEN)
  })
  it('does nothing on /reset-password itself (no redirect loop)', () => {
    expect(recoveryLandingTarget('/reset-password', TOKEN)).toBeNull()
    expect(recoveryLandingTarget('/reset-password/', EXPIRED)).toBeNull()
  })
  it('never hijacks Google sign-in: access_denied on the OAuth callback (customer cancelled) is left alone', () => {
    expect(recoveryLandingTarget('/auth/google-callback', '#error=access_denied&error_code=otp_expired')).toBeNull()
    expect(recoveryLandingTarget('/auth/google-callback', '#access_token=x&refresh_token=y')).toBeNull()
  })
  it('ignores an expired-link error on non-home pages and unrelated hashes', () => {
    expect(recoveryLandingTarget('/products', EXPIRED)).toBeNull()
    expect(recoveryLandingTarget('/', '#section=reviews')).toBeNull()
    expect(recoveryLandingTarget('/', '')).toBeNull()
  })
  it('does not treat a non-recovery access_token (Google implicit login) as a reset link', () => {
    expect(recoveryLandingTarget('/', '#access_token=x&refresh_token=y&type=signup')).toBeNull()
  })
})

describe('friendlyLinkError', () => {
  it('turns the raw Supabase text into one clear sentence', () => {
    expect(friendlyLinkError('Email link is invalid or has expired')).toMatch(/expired or was already used/)
  })
  it('has a default for a missing description and passes unknown text through', () => {
    expect(friendlyLinkError(null)).toMatch(/invalid or has expired/)
    expect(friendlyLinkError('Something else')).toBe('Something else')
  })
})
