import { describe, it, expect } from 'vitest'
import { isSignupConfirmationHash, recoveryLandingTarget } from '@/app/reset-password/resetPasswordHelpers'

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
