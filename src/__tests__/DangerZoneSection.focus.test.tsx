// @vitest-environment jsdom
/**
 * DangerZoneSection.focus.test.tsx
 *
 * Covers two related focus-management bugs found in a fresh audit pass:
 *
 *   1. openModal() only ever focused inputRef — but that input doesn't
 *      exist until step 2 (conditionally rendered). At step 1, nothing
 *      inside the modal received focus at all, so the Tab-trap (which
 *      only fires for keydown events bubbling from inside the modal)
 *      could be bypassed by a keyboard user whose focus never actually
 *      moved into the modal.
 *   2. Clicking "Continue" (step 1 -> step 2) unmounts the button that
 *      had focus, since step 1's whole block is replaced by step 2's —
 *      in some browsers this throws focus out to <body>, escaping the
 *      modal. Fixed to explicitly move focus to the new text input.
 *
 * Zero test coverage existed for this component before this file.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

import DangerZoneSection from '@/app/account/_sections/DangerZoneSection'

describe('DangerZoneSection — modal focus management', () => {
  it('focuses something inside the modal immediately on open (step 1)', async () => {
    render(<DangerZoneSection userEmail="jane@example.com" onLogout={vi.fn()} showToast={vi.fn()} />)

    fireEvent.click(screen.getByText('Delete Account'))

    // This is the actual bug: previously nothing inside the modal ever
    // received focus at step 1, since openModal() only targeted the
    // step-2 text input, which doesn't exist yet.
    await waitFor(() => {
      const active = document.activeElement
      expect(active?.closest('[role="dialog"]')).toBeTruthy()
    })
  })

  it('moves focus to the confirmation input after advancing to step 2', async () => {
    render(<DangerZoneSection userEmail="jane@example.com" onLogout={vi.fn()} showToast={vi.fn()} />)

    fireEvent.click(screen.getByText('Delete Account'))
    fireEvent.click(await screen.findByText('Continue →'))

    // This is the actual bug: the "Continue" button had focus and gets
    // unmounted the instant step becomes 2 — without an explicit refocus,
    // some browsers fall back to <body>, throwing focus outside the modal.
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Type DELETE to confirm account deletion'))
    })
  })
})
