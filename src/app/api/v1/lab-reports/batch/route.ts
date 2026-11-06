/**
 * GET /api/v1/lab-reports/batch?batch=HVP-HNY-001 — the jar-label batch lookup.
 *
 * PERF FIX (F-3): /lab-reports used to read `?batch=` in its Server Component,
 * which made the whole page dynamic (rendered on every request, every QR scan
 * hit Supabase for the report list too). The page is static now and the
 * browser asks this route only when a batch number is actually submitted.
 *
 * Response (always 200 for a well-formed request):
 *   { batch: BatchInfo | null, reports: CertRow[] | null }
 *   - batch:   the active batch, or null when unknown/invalid
 *   - reports: that batch's product's reports when the batch is tied to a
 *              product (and certificates are switched on), else null = keep
 *              showing the page's default list.
 */
import { NextResponse } from 'next/server'
import { getSiteSettings, isEnabled } from '@/lib/getSiteSettings'
import { BATCH_RE, loadBatch, loadReports, normalizeBatchNo } from '@/lib/labReports'

export async function GET(req: Request) {
  const batchNo = normalizeBatchNo(new URL(req.url).searchParams.get('batch'))
  if (!batchNo) return NextResponse.json({ error: 'batch is required' }, { status: 400 })
  if (!BATCH_RE.test(batchNo)) return NextResponse.json({ batch: null, reports: null })

  const [settings, found] = await Promise.all([getSiteSettings(), loadBatch(batchNo)])
  const reports = found?.productId && isEnabled(settings.show_certificates) ? await loadReports(found.productId) : null

  return NextResponse.json(
    { batch: found?.info ?? null, reports },
    // A batch's dates do not change once printed; a short shared cache absorbs repeat scans of the same jar.
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
  )
}
