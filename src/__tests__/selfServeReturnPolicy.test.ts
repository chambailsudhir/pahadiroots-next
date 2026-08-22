// ── selfServeReturnPolicy.test.ts ───────────────────────────────────────────
// Aug 22, 2026: FSSAI-consistent food-safety policy — self-serve returns
// and replacements restricted to genuine quality/fulfillment issues only,
// same practice as BigBasket/Blinkit/Amazon Fresh for consumables. Once a
// food item leaves the warehouse it can never be verified untampered and
// resold, so every "changed my mind" self-serve return would be pure loss
// with zero policy friction — this pins the exact reason set so it can't
// silently drift back open. See SELF_SERVE_RETURN_REASONS's own comment in
// constants.ts for the full reasoning. Enforced server-side in
// /api/orders/[id]/return/route.ts (see orderReturnRoute.test.ts's own
// 422 tests) and in the UI's reason radio-list (OrdersSection.tsx); this
// file tests the shared source of truth both of those read from.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  RETURN_REASON_CODES,
  REPLACEMENT_ALLOWED_REASONS,
  SELF_SERVE_RETURN_REASONS,
  canReplace,
  canSelfServeReturn,
} from '@/lib/account/constants'

describe('Self-serve return-reason policy', () => {
  it('allows exactly the 4 genuine-issue reasons self-serve', () => {
    expect(SELF_SERVE_RETURN_REASONS.sort()).toEqual(
      ['damaged', 'wrong_item', 'not_as_described', 'missing_parts'].sort()
    )
  })

  it('blocks changed_mind and other from self-serve, even though they remain valid reason codes overall', () => {
    expect(canSelfServeReturn('changed_mind')).toBe(false)
    expect(canSelfServeReturn('other')).toBe(false)
    // Still valid CODES (admin staff can log them manually) — just not
    // self-serve. Confirms this is a self-serve gate, not a code-validity
    // change to RETURN_REASON_CODES itself.
    expect(RETURN_REASON_CODES).toContain('changed_mind')
    expect(RETURN_REASON_CODES).toContain('other')
  })

  it('allows every genuine-issue reason self-serve', () => {
    for (const reason of SELF_SERVE_RETURN_REASONS) {
      expect(canSelfServeReturn(reason)).toBe(true)
    }
  })

  it('rejects an unrecognised reason string (defense in depth — callers must still check RETURN_REASON_CODES first)', () => {
    expect(canSelfServeReturn('not_a_real_reason')).toBe(false)
  })

  it('keeps SELF_SERVE_RETURN_REASONS as a genuinely separate constant from REPLACEMENT_ALLOWED_REASONS, not an alias', () => {
    // They start out with identical values (both gate to the same 4 codes
    // today), but are separate arrays for separate concerns — one gates
    // which reasons can result in a REPLACEMENT, the other gates which
    // reasons a customer can self-serve submit at ALL (refund or replace).
    // This test only pins today's coincidental equality; it is not an
    // assertion that they must always match.
    expect(SELF_SERVE_RETURN_REASONS).not.toBe(REPLACEMENT_ALLOWED_REASONS)
    expect(SELF_SERVE_RETURN_REASONS.sort()).toEqual([...REPLACEMENT_ALLOWED_REASONS].sort())
  })

  it('canReplace and canSelfServeReturn agree on every reason code today', () => {
    for (const { code } of [
      { code: 'damaged' }, { code: 'wrong_item' }, { code: 'not_as_described' },
      { code: 'missing_parts' }, { code: 'changed_mind' }, { code: 'other' },
    ]) {
      expect(canReplace(code)).toBe(canSelfServeReturn(code))
    }
  })
})
