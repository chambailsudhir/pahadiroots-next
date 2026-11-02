// @vitest-environment jsdom
// Nov 2026: nothing is preselected — the customer must choose a payment method themselves.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PaymentSection from '@/components/checkout/PaymentSection'

const base = {
  onChange: vi.fn(), razorpayEnabled: true, codOk: true, codEnabled: true,
  prepaidPct: 5, prepaidDiscount: 40, codMax: 3000, total: 800,
}

describe('PaymentSection — no default selection', () => {
  it('shows neither option as selected until the customer chooses', () => {
    render(<PaymentSection {...base} payMethod="cod" payMethodChosen={false} />)
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.length).toBeGreaterThanOrEqual(2)
    expect(radios.every(r => !r.checked)).toBe(true)
  })

  it('does not advertise the prepaid saving as if it were applied before a choice is made', () => {
    render(<PaymentSection {...base} payMethod="razorpay" payMethodChosen={false} />)
    expect((screen.getAllByRole('radio') as HTMLInputElement[]).some(r => r.checked)).toBe(false)
  })

  it('selects exactly the option the customer clicks', () => {
    const onChange = vi.fn()
    const { rerender } = render(<PaymentSection {...base} onChange={onChange} payMethod="cod" payMethodChosen={false} />)
    const [online] = screen.getAllByRole('radio') as HTMLInputElement[]
    fireEvent.click(online)
    expect(onChange).toHaveBeenCalledWith('razorpay')
    rerender(<PaymentSection {...base} onChange={onChange} payMethod="razorpay" payMethodChosen />)
    const after = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(after.filter(r => r.checked)).toHaveLength(1)
    expect(after[0].checked).toBe(true)
  })
})
