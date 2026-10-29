// Copy helpers derived ONLY from what the linked certificate actually ticks (admin → Certificates tab:
// has_purity / has_heavy_metals / has_pesticides / has_active_ingredients). Used so PDP claims such as
// "lab tested for …" can never say more than the certificate on file does (PDP audit P0-1 / P1-3).
export interface CertificateFlags {
  hasPurity: boolean
  hasHeavyMetals: boolean
  hasPesticides: boolean
  hasActiveIngredients: boolean
}

export function certifiedParameters(c: CertificateFlags | null | undefined): string[] {
  if (!c) return []
  const out: string[] = []
  if (c.hasPurity) out.push('purity')
  if (c.hasHeavyMetals) out.push('heavy metals')
  if (c.hasPesticides) out.push('pesticides')
  if (c.hasActiveIngredients) out.push('active ingredients')
  return out
}

/** ['purity','heavy metals','pesticides'] → "purity, heavy metals & pesticides" */
export function joinParameters(list: string[]): string {
  if (list.length <= 1) return list.join('')
  return `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}`
}

/** A product can have several active reports (admin: product_certificates is many-to-many). Claims such as
 *  "lab tested for …" must reflect ALL of them, so union the ticked parameters. */
export function mergeCertificateFlags(list: CertificateFlags[] | null | undefined): CertificateFlags | null {
  if (!list || list.length === 0) return null
  return {
    hasPurity:            list.some(c => c.hasPurity),
    hasHeavyMetals:       list.some(c => c.hasHeavyMetals),
    hasPesticides:        list.some(c => c.hasPesticides),
    hasActiveIngredients: list.some(c => c.hasActiveIngredients),
  }
}

/**
 * A certificate may back a customer-facing "Lab Tested" claim only while it is CURRENT (marketplace / FSSAI-style
 * rule: a claim needs identifiable evidence): a named lab, a test date that is not in the future, and either an
 * explicit expiry that has not passed or — when no expiry is recorded — a test no older than 24 months.
 * An uploaded file alone is never enough.
 */
export interface CertificateEvidence {
  labName?: string | null
  testedOn?: string | null   // YYYY-MM-DD
  expiresOn?: string | null  // YYYY-MM-DD
}

export const CERT_MAX_AGE_DAYS = 730

const toDay = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`)
  return Number.isFinite(t) ? Math.floor(t / 86_400_000) : null
}

export function isCurrentCertificate(c: CertificateEvidence, now: Date = new Date()): boolean {
  if (!String(c.labName ?? '').trim()) return false
  const today = Math.floor(now.getTime() / 86_400_000)
  const tested = toDay(c.testedOn)
  if (tested === null || tested > today) return false
  const expires = toDay(c.expiresOn)
  if (c.expiresOn) return expires !== null && expires >= today
  return today - tested <= CERT_MAX_AGE_DAYS
}
