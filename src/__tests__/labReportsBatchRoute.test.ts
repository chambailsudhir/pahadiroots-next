/**
 * labReportsBatchRoute.test.ts — GET /api/v1/lab-reports/batch (PERF FIX F-3:
 * the jar-batch lookup moved out of the /lab-reports Server Component so the
 * page can be served from the ISR cache).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const loadBatch = vi.fn()
const loadReports = vi.fn()
const getSiteSettings = vi.fn()
vi.mock('@/lib/labReports', async () => {
  const actual = await vi.importActual<typeof import('@/lib/labReports')>('@/lib/labReports')
  return { ...actual, loadBatch: (b: string) => loadBatch(b), loadReports: (id?: number | null) => loadReports(id) }
})
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/lib/getSiteSettings', () => ({ getSiteSettings: () => getSiteSettings(), isEnabled: (v: unknown) => v !== 'false' }))

const req = (qs: string) => new Request(`http://localhost/api/v1/lab-reports/batch${qs}`)

beforeEach(() => {
  loadBatch.mockReset(); loadReports.mockReset()
  getSiteSettings.mockResolvedValue({ show_certificates: 'true' })
})

describe('GET /api/v1/lab-reports/batch', () => {
  it('400 without a batch number', async () => {
    const { GET } = await import('@/app/api/v1/lab-reports/batch/route')
    expect((await GET(req(''))).status).toBe(400)
    expect(loadBatch).not.toHaveBeenCalled()
  })

  it('junk that fails the batch-number format never reaches the database', async () => {
    const { GET } = await import('@/app/api/v1/lab-reports/batch/route')
    const res = await GET(req('?batch=' + encodeURIComponent("x' or 1=1")))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ batch: null, reports: null })
    expect(loadBatch).not.toHaveBeenCalled()
  })

  it('normalises the typed number and returns the batch plus its product\'s reports', async () => {
    loadBatch.mockResolvedValue({ info: { batch_no: 'HVP-HNY-001', product_name: 'Wild Honey', pack_date: '2026-05-02', best_before: null }, productId: 42 })
    loadReports.mockResolvedValue([{ id: 1, report_url: 'https://r/1.pdf', has_purity: true, has_heavy_metals: false, has_pesticides: false, has_active_ingredients: false }])
    const { GET } = await import('@/app/api/v1/lab-reports/batch/route')
    const res = await GET(req('?batch=%20hvp-hny-001%20'))
    expect(loadBatch).toHaveBeenCalledWith('HVP-HNY-001')
    expect(loadReports).toHaveBeenCalledWith(42)
    const json = await res.json()
    expect(json.batch.product_name).toBe('Wild Honey')
    expect(json.batch).not.toHaveProperty('product_id')
    expect(json.reports).toHaveLength(1)
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=60')
  })

  it('unknown batch → null, and reports stay null when certificates are switched off', async () => {
    loadBatch.mockResolvedValue(null)
    const { GET } = await import('@/app/api/v1/lab-reports/batch/route')
    expect(await (await GET(req('?batch=HVP-HNY-999'))).json()).toEqual({ batch: null, reports: null })

    getSiteSettings.mockResolvedValue({ show_certificates: 'false' })
    loadBatch.mockResolvedValue({ info: { batch_no: 'HVP-HNY-001', product_name: null, pack_date: null, best_before: null }, productId: 42 })
    const json = await (await GET(req('?batch=HVP-HNY-001'))).json()
    expect(json.batch.batch_no).toBe('HVP-HNY-001')
    expect(json.reports).toBeNull()
    expect(loadReports).not.toHaveBeenCalled()
  })
})
