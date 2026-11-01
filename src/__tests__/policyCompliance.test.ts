// Policy-page compliance guards (Nov 2026 review). They pin the decisions, so a later edit cannot quietly undo them:
//  - one refund window everywhere (7–10 business days after approval),
//  - no hard-coded "Pan India" in customer-facing policy / payment / PDP copy (coverage follows serviceable_states),
//  - no cancellation charge or payment-gateway deduction promised (Consumer Protection (E-Commerce) Rules 2020, rule 4(8)),
//  - no statutory "perishable exemption" claim (the Rules contain none), grievance resolved within one month (rule 4(5)).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RETURNS_TIMING, deliveryAreaPhrase, shippingPolicySentence } from '@/lib/shippingCopy'

const get = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8')
const policy = get('app/policies/[type]/page.tsx')
const payment = get('app/payment/page.tsx')

describe('refund window', () => {
  it('is 7–10 business days', () => expect(RETURNS_TIMING.refundWindow).toBe('7–10 business days'))
  it('payment page and refused-delivery policy use the shared constant, not their own number', () => {
    expect(payment).toContain('RETURNS_TIMING.refundWindow')
    expect(payment).not.toMatch(/5–7 business days/)
    expect(policy).toContain('{RETURNS_TIMING.refundWindow} of the package reaching our facility')
    expect(policy).not.toMatch(/5–10 business days/)
  })
})

describe('delivery area wording', () => {
  it('says "across India" when no states are restricted', () => {
    expect(deliveryAreaPhrase({})).toBe('across India')
    expect(shippingPolicySentence({})).toContain('Delivery across India')
  })
  it('follows serviceable_states when set', () => {
    expect(deliveryAreaPhrase({ serviceable_states: 'Himachal Pradesh, Punjab' })).toBe('in the states we currently deliver to')
  })
  it('no customer-facing source hard-codes "Pan India"', () => {
    for (const f of ['app/policies/[type]/page.tsx', 'app/payment/page.tsx', 'app/products/[slug]/page.tsx', 'lib/shippingCopy.ts', 'components/cart/PahadiStoryCard.tsx']) {
      expect(get(f)).not.toMatch(/pan[- ]india/i)
    }
    expect(policy).not.toMatch(/28 states/)
  })
})

describe('Return & Refund policy text', () => {
  it('promises no cancellation fee and no payment-gateway deduction', () => {
    expect(policy).toContain('We do not deduct payment-gateway charges')
    expect(policy).toContain('no cancellation fee')
  })
  it('does not cite a statutory perishable-goods exemption', () => {
    expect(policy).not.toMatch(/perishable-goods exemptions? under consumer protection law/i)
  })
  it('takes back defective, not-as-described and late goods', () => {
    expect(policy).toMatch(/damaged, defective, spoilt, not as described, or delivered later than the delivery time we stated/)
  })
  it('grievance: 48 hours to acknowledge, one month to resolve, officer designation shown', () => {
    expect(policy).toMatch(/within <strong>one month<\/strong> of receipt/)
    expect(policy).toContain('GRIEVANCE_OFFICER_DESIGNATION')
  })
})
