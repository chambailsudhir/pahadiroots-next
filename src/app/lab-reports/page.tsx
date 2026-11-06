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
//
// PERF FIX (F-3): the batch lookup used to read `?batch=` here, which made the
// whole page dynamic — every QR scan rendered it from scratch (report queries
// included) and `revalidate` could not apply. The Server Component now renders
// only the default report list and is served from the ISR cache; the batch
// lookup runs in the browser (LabReportsClient → /api/v1/lab-reports/batch).
// ─────────────────────────────────────────────────────────────────────────────
import type { Metadata } from 'next'
import { getSiteSettings, isEnabled } from '@/lib/getSiteSettings'
import { loadReports } from '@/lib/labReports'
import LabReportsClient from '@/components/lab-reports/LabReportsClient'

export const metadata: Metadata = {
  title: 'Honey Lab Test Reports',
  description: 'View the independent lab test reports for HimVeda by Pahadi Roots honey.',
  alternates: { canonical: '/lab-reports' },
  // Indexable: the lab reports are the strongest trust proof the shop has, and people search for them (audit HOME-022).
  robots: { index: true, follow: true },
}

// A newly uploaded report shows up within this window; admin saves can revalidate sooner.
export const revalidate = 300

export default async function LabReportsPage() {
  const settings = await getSiteSettings()
  const reports = isEnabled(settings.show_certificates) ? await loadReports() : []
  return <LabReportsClient defaultReports={reports} />
}
