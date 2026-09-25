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

interface CertificateCardProps {
  certificate: {
    reportUrl: string
    hasPurity: boolean
    hasHeavyMetals: boolean
    hasPesticides: boolean
    hasActiveIngredients: boolean
  }
}

const CHIPS: { key: keyof CertificateCardProps['certificate']; label: string; variant: string }[] = [
  { key: 'hasPurity',            label: 'Purity',             variant: 'green'  },
  { key: 'hasHeavyMetals',       label: 'Heavy Metals',       variant: 'peach'  },
  { key: 'hasPesticides',        label: 'Pesticides',         variant: 'purple' },
  { key: 'hasActiveIngredients', label: 'Active Ingredients', variant: 'blue'   },
]

export default function CertificateCard({ certificate }: CertificateCardProps) {
  const activeChips = CHIPS.filter(c => certificate[c.key])
  if (activeChips.length === 0) return null

  return (
    <div className="pdp-certificate-section">
      <div className="pdp-certificate-label">Certificate</div>
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
          <div className="pdp-cert-chips">
            {activeChips.map(c => (
              <span key={String(c.key)} className={`pdp-cert-chip pdp-cert-chip--${c.variant}`}>
                <span aria-hidden="true">•</span> {c.label}
              </span>
            ))}
          </div>
          <a
            href={certificate.reportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="pdp-cert-link"
          >
            View Authenticity Report <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </div>
  )
}
