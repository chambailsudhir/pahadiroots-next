// ── CertificateCard ────────────────────────────────────────────────────────
// "Lab Tested & Verified" card on the PDP, sourced from the certificates /
// product_certificates tables (see pahadi-admin's CertificatesTab).
//
// DELIBERATE (per Sudhir, Sept 2026): no batch number, harvest date, or
// source region is shown here — only the parameters actually confirmed by
// the linked certificate. Matches the reference site (mypahadidukan.com),
// whose card is equally generic. Don't add specific wording back in without
// checking first — see the comment at the top of CertificatesTab in the
// admin repo for the full reasoning.
// ─────────────────────────────────────────────────────────────────────────────

export interface CertificateData {
  reportUrl: string
  hasPurity: boolean
  hasHeavyMetals: boolean
  hasPesticides: boolean
  hasActiveIngredients: boolean
}

// A product can have SEVERAL active reports (admin: product_certificates is many-to-many, e.g. one report for
// active ingredients and another for purity/heavy metals). The PDP used to fetch only the newest one
// (.limit(1).maybeSingle()), so the others silently never appeared. `certificates` shows every one;
// `certificate` (single) is kept for backward compatibility.
interface CertificateCardProps {
  certificates?: CertificateData[] | null
  certificate?: CertificateData | null
}

const CHIPS: { key: Exclude<keyof CertificateData, 'reportUrl'>; label: string; variant: string }[] = [
  { key: 'hasPurity',            label: 'Purity',             variant: 'green'  },
  { key: 'hasHeavyMetals',       label: 'Heavy Metals',       variant: 'peach'  },
  { key: 'hasPesticides',        label: 'Pesticides',         variant: 'purple' },
  { key: 'hasActiveIngredients', label: 'Active Ingredients', variant: 'blue'   },
]

export default function CertificateCard({ certificates, certificate }: CertificateCardProps) {
  const all = certificates ?? (certificate ? [certificate] : [])
  // Same rule as before per report (a report that ticks nothing shows nothing), plus: skip a report with no
  // link and show a given report URL only once.
  const seen = new Set<string>()
  const reports = all
    .map(c => ({ c, chips: CHIPS.filter(ch => c[ch.key]) }))
    .filter(({ c, chips }) => {
      if (!c.reportUrl || chips.length === 0 || seen.has(c.reportUrl)) return false
      seen.add(c.reportUrl)
      return true
    })
  if (reports.length === 0) return null
  const many = reports.length > 1

  return (
    <div className="pdp-certificate-section">
      <div className="pdp-certificate-label">{many ? 'Certificates' : 'Certificate'}</div>
      <div className="pdp-certificate-card">
        <div className="pdp-cert-icon" aria-hidden="true">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8">
            <path d="M9 2h6v4.2l3 5.3a5 5 0 1 1-12 0l3-5.3V2Z" />
            <path d="M9 2h6" strokeLinecap="round" />
            <circle cx="12" cy="15" r="1.4" fill="#fff" stroke="none" />
          </svg>
        </div>
        <div className="pdp-cert-body">
          <div className="pdp-cert-heading">Lab Tested &amp; Verified</div>
          {reports.map(({ c, chips }, i) => (
            <div key={c.reportUrl} className="pdp-cert-report">
              <div className="pdp-cert-chips">
                {chips.map(ch => (
                  <span key={String(ch.key)} className={`pdp-cert-chip pdp-cert-chip--${ch.variant}`}>
                    <span aria-hidden="true">•</span> {ch.label}
                  </span>
                ))}
              </div>
              <a
                href={c.reportUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="pdp-cert-link"
              >
                {many ? `View Authenticity Report ${i + 1}` : 'View Authenticity Report'} <span aria-hidden="true">→</span>
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
