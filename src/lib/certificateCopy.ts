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
