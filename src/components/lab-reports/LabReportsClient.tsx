'use client'

// PERF FIX (F-3): /lab-reports read `?batch=` in its Server Component, so the
// page — the landing page for the QR code on every honey jar — was rendered
// on every request and never served from the ISR cache. The server now
// renders the default report list and this component handles the jar-batch
// lookup in the browser: it reads `?batch=` (the form still GETs to
// /lab-reports, so the URL is unchanged and shareable), asks
// /api/v1/lab-reports/batch, and shows the same verified / not-found cards.
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import SearchParamsBridge from '@/components/ui/SearchParamsBridge'
import { certifiedParameters, joinParameters } from '@/lib/certificateCopy'
import type { BatchInfo, CertRow } from '@/lib/labReports'

export const BATCH_LOOKUP_ENDPOINT = '/api/v1/lab-reports/batch'

interface Props { defaultReports: CertRow[] }

/** Outcome of one lookup, remembered with the batch it answers so a new batch reads as "loading" until its own answer lands. */
type Lookup =
  | { batch: string; status: 'failed' }
  | { batch: string; status: 'done'; info: BatchInfo | null; reports: CertRow[] | null }

function fmtDate(d: string | null) {
  if (!d) return '—'
  const dt = new Date(`${d}T00:00:00Z`)
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function titleCase(s: string) {
  return s.replace(/\b\w/g, m => m.toUpperCase())
}

export default function LabReportsClient({ defaultReports }: Props) {
  // The batch as typed on the jar form (already upper-cased/trimmed, max 32 chars — same rule as the server).
  const [rawBatch, setRawBatch] = useState('')
  const onChange = useCallback((sp: URLSearchParams) => {
    setRawBatch((sp.get('batch') ?? '').trim().toUpperCase().slice(0, 32))
  }, [])
  const [result, setResult] = useState<Lookup | null>(null)

  useEffect(() => {
    if (!rawBatch) return
    let cancelled = false
    fetch(`${BATCH_LOOKUP_ENDPOINT}?batch=${encodeURIComponent(rawBatch)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { batch?: BatchInfo | null; reports?: CertRow[] | null }) => {
        if (!cancelled) setResult({ batch: rawBatch, status: 'done', info: d.batch ?? null, reports: Array.isArray(d.reports) ? d.reports : null })
      })
      .catch(() => { if (!cancelled) setResult({ batch: rawBatch, status: 'failed' }) })
    return () => { cancelled = true }
  }, [rawBatch])

  // Derived: an answer only counts for the batch currently in the URL.
  const lookup: Lookup | { status: 'idle' } | { status: 'loading' } =
    !rawBatch ? { status: 'idle' } : result && result.batch === rawBatch ? result : { status: 'loading' }
  const batch = lookup.status === 'done' ? lookup.info : null
  // Batch found and tied to a product → that product's reports only; otherwise all honey reports.
  const reports = lookup.status === 'done' && lookup.reports ? lookup.reports : defaultReports

  return (
    <main className="max-w-xl mx-auto px-4 py-10 sm:py-14">
      <SearchParamsBridge onChange={onChange} />
      <p className="text-xs font-semibold tracking-widest text-emerald-800 uppercase">Lab Tested &amp; Verified</p>
      <h1 className="mt-2 text-2xl sm:text-3xl font-bold text-stone-900">Honey Lab Test Reports</h1>
      <p className="mt-3 text-sm text-stone-600 leading-relaxed">
        Independent laboratory reports for our honey. Tap a report to open the original document.
      </p>

      <form action="/lab-reports" method="get" className="mt-6 rounded-xl border border-stone-200 bg-white p-4">
        <label htmlFor="batch" className="block text-sm font-semibold text-stone-800">Enter the batch number from your jar</label>
        <div className="mt-2 flex gap-2">
          {/* key: a batch arriving from the URL (QR link, back button) re-seeds the uncontrolled input. */}
          <input
            key={rawBatch}
            id="batch" name="batch" defaultValue={rawBatch} placeholder="HVP-HNY-001"
            maxLength={32} autoCapitalize="characters" autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm uppercase"
          />
          <button type="submit" className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white">Check</button>
        </div>
      </form>

      {rawBatch && lookup.status === 'loading' && (
        <div className="mt-4 rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-600" role="status" aria-busy="true">
          Checking batch <span className="font-mono font-semibold">{rawBatch}</span>…
        </div>
      )}
      {rawBatch && lookup.status === 'failed' && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-stone-700" role="status">
          We couldn&apos;t check batch <span className="font-mono font-semibold">{rawBatch}</span> right now. Please try again in a moment,
          or write to us at <a href="mailto:hello@pahadiroots.com" className="font-semibold text-emerald-800 underline">hello@pahadiroots.com</a>.
        </div>
      )}
      {rawBatch && lookup.status === 'done' && (
        batch ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-5" role="status">
            <div className="text-xs font-semibold text-emerald-800">Batch verified</div>
            <div className="mt-1 text-lg font-bold text-stone-900 font-mono">{batch.batch_no}</div>
            {batch.product_name && <div className="text-sm text-stone-700">{batch.product_name}</div>}
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
            We couldn&apos;t find batch <span className="font-mono font-semibold">{rawBatch}</span>. Please check the number printed on your jar,
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
