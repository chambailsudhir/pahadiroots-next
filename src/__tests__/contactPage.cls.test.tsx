// @vitest-environment jsdom
/**
 * L2 (Nov 2026 audit): /contact had CLS 0.066 on phones because the e-mail and address cards appear only once the
 * site_settings fetch resolves (~2.7 s cold) and pushed the form card down. While loading, two same-height placeholders
 * now hold that space; once the data is in, the real cards replace them 1:1.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

const swrState = vi.hoisted(() => ({ data: undefined as unknown }))
vi.mock('swr', () => ({ default: () => ({ data: swrState.data }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }))

import ContactPage from '@/app/contact/page'

describe('/contact reserves the contact-card space while settings load', () => {
  it('shows two aria-hidden placeholders before the settings arrive', () => {
    swrState.data = undefined
    render(<ContactPage />)
    const ph = screen.getAllByTestId('contact-card-placeholder')
    expect(ph).toHaveLength(2)
    for (const el of ph) expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByText('Email us')).toBeNull()
  })
  it('swaps them for the real e-mail and address cards once the settings arrive', () => {
    swrState.data = { contact_email: 'hello@example.com', contact_address: '1 Hill Road', whatsapp_number: '919999999999' }
    render(<ContactPage />)
    expect(screen.queryAllByTestId('contact-card-placeholder')).toHaveLength(0)
    expect(screen.getByText('Email us')).toBeTruthy()
    expect(screen.getByText('Our Address')).toBeTruthy()
  })
  it('an empty settings row set shows no placeholder either (nothing to wait for)', () => {
    swrState.data = {}
    render(<ContactPage />)
    expect(screen.queryAllByTestId('contact-card-placeholder')).toHaveLength(0)
  })
})
