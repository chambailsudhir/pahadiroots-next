// ─────────────────────────────────────────────────────────────────────────────
// lib/consentRegion.ts — which visitors must be asked before analytics starts.
//
// India's DPDP notice-and-consent rules only start on 14 May 2027, and an India-only shop is
// outside GDPR — which is why amazon.in / myntra.com show no cookie banner to Indian visitors.
// Large global sites show a consent banner only where the law requires it (EEA, UK, Switzerland).
// We do the same, driven by the visitor's country, and the owner can override it from the admin
// (site setting `cookie_consent_mode`):
//   'region' (default) — banner for EEA / UK / Switzerland (+ unknown country); analytics ON elsewhere
//   'always'           — banner for everyone (use before DPDP starts on 14 May 2027)
//   'off'              — banner for nobody; analytics always on (visitors can still opt out from the footer)
//
// The country comes from Vercel's `x-vercel-ip-country` request header, read in proxy.ts and handed to
// the browser as the `hv_geo` cookie, so the page HTML itself stays cacheable (ISR) for everyone.
// ─────────────────────────────────────────────────────────────────────────────

export type ConsentMode = 'region' | 'always' | 'off'
export const GEO_COOKIE = 'hv_geo'
export type GeoValue = 'eu' | 'row' | 'unk'

/** EU 27 + EEA (IS, LI, NO) + United Kingdom + Switzerland. */
const CONSENT_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT',
  'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH',
])

export function normalizeConsentMode(v: unknown): ConsentMode {
  return v === 'always' || v === 'off' ? v : 'region'
}

/** 'eu' = consent law applies, 'row' = rest of world, 'unk' = unknown (treated like 'eu': the safe side). */
export function geoValueFor(country: string | null | undefined): GeoValue {
  const c = (country ?? '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return 'unk'
  return CONSENT_COUNTRIES.has(c) ? 'eu' : 'row'
}

/** The single rule: is a consent choice required for this visitor? */
export function isConsentRequiredFor(mode: ConsentMode, geo: GeoValue | string | null | undefined): boolean {
  if (mode === 'always') return true
  if (mode === 'off') return false
  return geo !== 'row'   // 'eu', 'unk', or anything unexpected -> ask
}
