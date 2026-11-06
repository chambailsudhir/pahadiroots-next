// @vitest-environment jsdom
/**
 * LabReportsClient.test.tsx — PERF FIX F-3: /lab-reports is static; the jar
 * batch lookup (?batch=) runs in the browser against /api/v1/lab-reports/batch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'

let params = new URLSearchParams('')
vi.mock('next/navigation', () => ({ useSearchParams: () => params, useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, href, ...r }: any) => React.createElement('a', { href, ...r }, children) }))

import LabReportsClient, { BATCH_LOOKUP_ENDPOINT } from '@/components/lab-reports/LabReportsClient'

const cert = (id: number, url: string) => ({ id, report_url: url, has_purity: true, has_heavy_metals: false, has_pesticides: false, has_active_ingredients: false })
const defaults = [cert(1, 'https://r/all-1.pdf'), cert(2, 'https://r/all-2.pdf')]

beforeEach(() => { params = new URLSearchParams('') })
afterEach(() => vi.unstubAllGlobals())

describe('LabReportsClient', () => {
  it('default view lists the server-rendered reports and makes no request', () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    render(<LabReportsClient defaultReports={defaults} />)
    expect(screen.getAllByText('View Report', { exact: false })).toHaveLength(2)
    expect(f).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('?batch= looks the jar up (upper-cased) and shows the verified card with that product\'s reports only', async () => {
    params = new URLSearchParams('batch=hvp-hny-001')
    const f = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({
      batch: { batch_no: 'HVP-HNY-001', product_name: 'Wild Honey', pack_date: '2026-05-02', best_before: '2027-05-01' },
      reports: [cert(9, 'https://r/wild.pdf')],
    }) })
    vi.stubGlobal('fetch', f)
    render(<LabReportsClient defaultReports={defaults} />)
    await waitFor(() => expect(screen.getByText('Batch verified')).toBeTruthy())
    expect(f).toHaveBeenCalledWith(`${BATCH_LOOKUP_ENDPOINT}?batch=HVP-HNY-001`)
    expect(screen.getByText('Wild Honey')).toBeTruthy()
    expect(screen.getByText('02 May 2026')).toBeTruthy()
    expect(screen.getAllByText('View Report', { exact: false })).toHaveLength(1)
    expect(screen.getByText('View Report', { exact: false }).closest('a')?.getAttribute('href')).toBe('https://r/wild.pdf')
    expect((screen.getByLabelText(/batch number/i) as HTMLInputElement).value).toBe('HVP-HNY-001')
  })

  it('an unknown batch shows the "couldn\'t find" note and keeps the default reports', async () => {
    params = new URLSearchParams('batch=NOPE-1')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ batch: null, reports: null }) }))
    render(<LabReportsClient defaultReports={defaults} />)
    await waitFor(() => expect(screen.getByText(/couldn.t find batch/)).toBeTruthy())
    expect(screen.getAllByText('View Report', { exact: false })).toHaveLength(2)
  })

  it('a failed lookup says so instead of claiming the batch does not exist', async () => {
    params = new URLSearchParams('batch=HVP-HNY-001')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) }))
    render(<LabReportsClient defaultReports={defaults} />)
    await waitFor(() => expect(screen.getByText(/couldn.t check batch/)).toBeTruthy())
    expect(screen.queryByText(/couldn.t find batch/)).toBeNull()
  })
})
