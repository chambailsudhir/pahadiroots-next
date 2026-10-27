// ── /lab-reports ────────────────────────────────────────────────────────────
// Single landing page for the QR code printed on honey jar labels. One QR works
// for every honey jar and keeps working when reports are replaced: it lists the
// ACTIVE certificates linked to active honey products (admin → Catalogue →
// Certificates), so a newly uploaded report appears here without reprinting.
//
// BATCH LOOKUP: the jar label carries a batch number (e.g. HVP-HNY-001). The
// customer types it below and sees pack date + best-before from `batches`. A
// batch has NO report of its own — lab reports cover the harvest/source — so the
// result says so explicitly rather than implying each batch was tested.
//
// Same rules as the PDP CertificateCard: only the parameters the certificate
// actually ticks are claimed; lab name and test date stay internal (admin marks
// them "not shown on the storefront"); the master "show certificates" switch
// hides everything; each report URL is shown once.
// ─────────────────────────────────────────────────────────────────────────────
import type { Metadata } from 'next'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { getSiteSettings, isEnabled } from '@/lib/getSiteSettings'
import { certifiedParameters, joinParameters } from '@/lib/certificateCopy'

export const metadata: Metadata = {
  title: 'Honey Lab Test Reports — HimVeda by Pahadi Roots',
  description: 'View the independent lab test reports for HimVeda by Pahadi Roots honey.',
  alternates: { canonical: '/lab-reports' },
  robots: { index: false, follow: true },
}

interface CertRow {
  id: number
  report_url: string
  has_purity: boolean
  has_heavy_metals: boolean
  has_pesticides: boolean
  has_active_ingredients: boolean
}

async function loadReports(): Promise<CertRow[]> {
  try {
    const { data: prods } = await supabase
      .from('products')
      .select('id')
      .eq('is_deleted', false)
      .eq('status', 'active')
      .ilike('name', '%honey%')
      .limit(200)
    const ids = (prods ?? []).map(p => p.id)
    if (ids.length === 0) return []

    const { data: links } = await supabase
      .from('product_certificates')
      .select('certificate_id')
      .in('product_id', ids)
      .limit(1000)
    const certIds = [...new Set((links ?? []).map(l => l.certificate_id))]
    if (certIds.length === 0) return []

    const { data: certs } = await supabase
      .from('certificates')
      .select('id, report_url, has_purity, has_heavy_metals, has_pesticides, has_active_ingredients')
      .in('id', certIds)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(20)

    const seen = new Set<string>()
    return ((certs ?? []) as CertRow[])
      .filter(c => {
        const ticks = c.has_purity || c.has_heavy_metals || c.has_pesticides || c.has_active_ingredients
        if (!c.report_url || !ticks || seen.has(c.report_url)) return false
        seen.add(c.report_url)
        return true
      })
      // Broadest report first (most ticked parameters), stable otherwise.
      .sort((a, b) => ticked(b) - ticked(a))
  } catch (e) {
    console.error('[lab-reports] fetch failed:', e)
    return []
  }
}

interface BatchRow {
  batch_no: string
  pack_date: string | null
  best_before: string | null
  products: { name: string } | { name: string }[] | null
}

// Same rule as the DB check constraint (batches_batch_no_format) — also stops junk reaching the query.
const BATCH_RE = /^[A-Z0-9-]{3,32}$/

async function loadBatch(batchNo: string): Promise<BatchRow | null> {
  try {
    const { data } = await supabase
      .from('batches')
      .select('batch_no, pack_date, best_before, products(name)')
      .eq('batch_no', batchNo)
      .eq('is_active', true)
      .maybeSingle()
    return (data as BatchRow | null) ?? null
  } catch (e) {
    console.error('[lab-reports] batch lookup failed:', e)
    return null
  }
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  const dt = new Date(`${d}T00:00:00Z`)
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function ticked(c: CertRow) {
  return [c.has_purity, c.has_heavy_metals, c.has_pesticides, c.has_active_ingredients].filter(Boolean).length
}

function titleCase(s: string) {
  return s.replace(/\b\w/g, m => m.toUpperCase())
}

export default async function LabReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const rawBatch = typeof sp.batch === 'string' ? sp.batch.trim().toUpperCase() : ''
  const batchValid = BATCH_RE.test(rawBatch)
  const [settings, batch] = await Promise.all([
    getSiteSettings(),
    batchValid ? loadBatch(rawBatch) : Promise.resolve(null),
  ])
  const reports = isEnabled(settings.show_certificates) ? await loadReports() : []
  const productName = batch ? (Array.isArray(batch.products) ? batch.products[0]?.name : batch.products?.name) : null

  return (
    <main className="max-w-xl mx-auto px-4 py-10 sm:py-14">
      <p className="text-xs font-semibold tracking-widest text-emerald-800 uppercase">Lab Tested &amp; Verified</p>
      <h1 className="mt-2 text-2xl sm:text-3xl font-bold text-stone-900">Honey Lab Test Reports</h1>
      <p className="mt-3 text-sm text-stone-600 leading-relaxed">
        Independent laboratory reports for our honey. Tap a report to open the original document.
      </p>

      <form action="/lab-reports" method="get" className="mt-6 rounded-xl border border-stone-200 bg-white p-4">
        <label htmlFor="batch" className="block text-sm font-semibold text-stone-800">Enter the batch number from your jar</label>
        <div className="mt-2 flex gap-2">
          <input
            id="batch" name="batch" defaultValue={rawBatch} placeholder="HVP-HNY-001"
            maxLength={32} autoCapitalize="characters" autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm uppercase"
          />
          <button type="submit" className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white">Check</button>
        </div>
      </form>

      {rawBatch && (
        batch ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-5" role="status">
            <div className="text-xs font-semibold text-emerald-800">Batch verified</div>
            <div className="mt-1 text-lg font-bold text-stone-900 font-mono">{batch.batch_no}</div>
            {productName && <div className="text-sm text-stone-700">{productName}</div>}
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-stone-500">Packed on</dt><dd className="font-semibold text-stone-900">{fmtDate(batch.pack_date)}</dd></div>
              <div><dt className="text-xs text-stone-500">Best before</dt><dd className="font-semibold text-stone-900">{fmtDate(batch.best_before)}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-stone-600">
              The lab reports below cover the harvest/source this honey comes from. They are not a separate test of this individual batch.
            </p>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-stone-700" role="status">
            We couldn&apos;t find batch <span className="font-mono font-semibold">{rawBatch.slice(0, 32)}</span>. Please check the number printed on your jar,
            or write to us at <a href="mailto:hello@pahadiroots.com" className="font-semibold text-emerald-800 underline">hello@pahadiroots.com</a>.
          </div>
        )
      )}

      {reports.length === 0 ? (
        <div className="mt-8 rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-600">
          Lab reports are not available right now. Please check our{' '}
          <Link href="/products" className="font-semibold text-emerald-800 underline">products</Link>{' '}
          or write to us at{' '}
          <a href="mailto:hello@pahadiroots.com" className="font-semibold text-emerald-800 underline">hello@pahadiroots.com</a>.
        </div>
      ) : (
        <ul className="mt-8 space-y-4">
          {reports.map((c, i) => {
            const params = certifiedParameters({
              hasPurity: c.has_purity,
              hasHeavyMetals: c.has_heavy_metals,
              hasPesticides: c.has_pesticides,
              hasActiveIngredients: c.has_active_ingredients,
            })
            return (
              <li key={c.id} className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-semibold text-stone-500">Report {i + 1}</div>
                <div className="mt-1 text-base font-semibold text-stone-900">
                  {titleCase(joinParameters(params))}
                </div>
                <a
                  href={c.report_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-1 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white"
                >
                  View Report <span aria-hidden="true">→</span>
                </a>
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-8 text-xs text-stone-500">
        <Link href="/products" className="underline">Shop our honey</Link>
      </p>
    </main>
  )
}
