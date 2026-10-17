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
