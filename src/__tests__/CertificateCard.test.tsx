/**
 * CertificateCard.test.tsx — regression for "I uploaded 2 reports in admin but only 1 shows on the PDP".
 * Cause: the PDP fetched only the newest linked certificate (.limit(1).maybeSingle()). The admin allows many
 * (product_certificates is many-to-many), so the card now renders every active report linked to the product.
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import CertificateCard from '@/components/product/CertificateCard'

const base = { hasPurity: false, hasHeavyMetals: false, hasPesticides: false, hasActiveIngredients: false }
const activeOnly = { ...base, hasActiveIngredients: true, reportUrl: 'https://cdn.example/active.pdf' }
const purityMetals = { ...base, hasPurity: true, hasHeavyMetals: true, reportUrl: 'https://cdn.example/purity.pdf' }

const links = (c: HTMLElement) => Array.from(c.querySelectorAll('a.pdp-cert-link')).map(a => ({ href: a.getAttribute('href'), text: a.textContent!.replace(/\s+/g, ' ').trim() }))

describe('CertificateCard — several reports', () => {
  it('shows BOTH reports, each with its own chips and its own link', () => {
    const { container } = render(<CertificateCard certificates={[activeOnly, purityMetals]} />)
    expect(links(container)).toEqual([
      { href: 'https://cdn.example/active.pdf', text: 'View Authenticity Report 1 →' },
      { href: 'https://cdn.example/purity.pdf', text: 'View Authenticity Report 2 →' },
    ])
    const reports = container.querySelectorAll('.pdp-cert-report')
    expect(reports).toHaveLength(2)
    expect(reports[0].textContent).toContain('Active Ingredients')
    expect(reports[1].textContent).toContain('Purity')
    expect(reports[1].textContent).toContain('Heavy Metals')
    expect(container.querySelector('.pdp-certificate-label')!.textContent).toBe('Certificates')
  })

  it('one report looks exactly like before (single label, unnumbered link)', () => {
    const { container } = render(<CertificateCard certificates={[activeOnly]} />)
    expect(links(container)).toEqual([{ href: 'https://cdn.example/active.pdf', text: 'View Authenticity Report →' }])
    expect(container.querySelector('.pdp-certificate-label')!.textContent).toBe('Certificate')
    expect(container.textContent).toContain('Active Ingredients')
  })

  it('still accepts the old single `certificate` prop', () => {
    const { container } = render(<CertificateCard certificate={purityMetals} />)
    expect(links(container)).toHaveLength(1)
  })

  it('skips a report that ticks nothing or has no link, and shows a repeated URL once', () => {
    const { container } = render(
      <CertificateCard certificates={[{ ...base, reportUrl: 'https://cdn.example/empty.pdf' }, { ...purityMetals, reportUrl: '' }, activeOnly, { ...activeOnly }]} />,
    )
    expect(links(container)).toEqual([{ href: 'https://cdn.example/active.pdf', text: 'View Authenticity Report →' }])
  })

  it('renders nothing when there is nothing to show (no empty card, no lab claim)', () => {
    expect(render(<CertificateCard certificates={[]} />).container.innerHTML).toBe('')
    expect(render(<CertificateCard certificates={null} />).container.innerHTML).toBe('')
    expect(render(<CertificateCard certificates={[{ ...base, reportUrl: 'https://x/y.pdf' }]} />).container.innerHTML).toBe('')
  })

  it('opens reports safely in a new tab', () => {
    const { container } = render(<CertificateCard certificates={[activeOnly, purityMetals]} />)
    container.querySelectorAll('a.pdp-cert-link').forEach(a => {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    })
  })
})
