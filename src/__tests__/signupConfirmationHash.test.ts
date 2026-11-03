import { describe, it, expect } from 'vitest'
import { isSignupConfirmationHash, isLiveTokenHash, isLinkErrorHash, recoveryLandingTarget } from '@/app/reset-password/resetPasswordHelpers'

describe('sign-up verification link landing', () => {
  it('recognises the signup payload (and only that)', () => {
    expect(isSignupConfirmationHash('#access_token=a&refresh_token=b&type=signup')).toBe(true)
    expect(isSignupConfirmationHash('#type=signup&access_token=a')).toBe(true)
    expect(isSignupConfirmationHash('#access_token=a&type=recovery')).toBe(false)
    expect(isSignupConfirmationHash('#type=signup')).toBe(false)
    expect(isSignupConfirmationHash('')).toBe(false)
  })
  it('a signup payload is never forwarded as if it were a password reset', () => {
    expect(recoveryLandingTarget('/account', '#access_token=a&type=signup')).toBeNull()
  })
})

describe('hash classification for e-mail links', () => {
  it('scrubs live tokens of every non-reset link type, never a recovery', () => {
    for (const t of ['signup', 'magiclink', 'invite', 'email_change']) expect(isLiveTokenHash(`#access_token=a&type=${t}`)).toBe(true)
    expect(isLiveTokenHash('#access_token=a&type=recovery')).toBe(false)
    expect(isLiveTokenHash('#access_token=a')).toBe(false)
  })
  it('recognises a failed / expired link (so the page never claims "verified")', () => {
    expect(isLinkErrorHash('#error=access_denied&error_code=otp_expired&error_description=x')).toBe(true)
    expect(isLinkErrorHash('#access_token=a&type=signup')).toBe(false)
    expect(isSignupConfirmationHash('#error=access_denied&error_code=otp_expired')).toBe(false)
  })
})
