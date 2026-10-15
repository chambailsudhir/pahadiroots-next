// ─────────────────────────────────────────────────────────────────────────────
// lib/serviceability.ts  (client-safe, pure)
//
// F-09 (Oct 2026 audit): there was no server-side check that an order's PIN/state is somewhere
// we deliver, so an order could be placed (and paid) for an unserviceable address.
//
// The rule is owner-defined, via two OPTIONAL admin settings (site_settings):
//   serviceable_states   comma-separated state names. Empty/unset → every state is served.
//   blocked_pincodes     comma/space-separated 6-digit PINs, or 3–5 digit PREFIXES (e.g. "193").
//                        Empty/unset → nothing blocked.
// With neither set behaviour is unchanged (all of India), so this ships safely; the owner turns the
// rule on by saving the settings. Enforced in createOrder (authoritative) — not just in the UI.
// ─────────────────────────────────────────────────────────────────────────────

export interface ServiceabilitySettings {
  serviceable_states?: string | null
  blocked_pincodes?:   string | null
}

export type ServiceabilityResult = { ok: true } | { ok: false; reason: string }

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
const splitList = (v: string | null | undefined, re: RegExp): string[] =>
  (v ?? '').split(re).map(x => x.trim()).filter(Boolean)

export function parseServiceableStates(v: string | null | undefined): string[] {
  return splitList(v, /[,;\n]/).map(norm)
}

export function parseBlockedPincodes(v: string | null | undefined): string[] {
  return splitList(v, /[\s,;]+/).filter(p => /^\d{3,6}$/.test(p))
}

export function checkServiceability(
  dest: { state?: string | null; pincode?: string | null },
  settings: ServiceabilitySettings | Record<string, string | undefined>,
): ServiceabilityResult {
  const s = settings as ServiceabilitySettings
  const states  = parseServiceableStates(s.serviceable_states)
  const blocked = parseBlockedPincodes(s.blocked_pincodes)
  const state   = norm(dest.state ?? '')
  const pin     = (dest.pincode ?? '').trim()

  if (states.length > 0 && !states.includes(state)) {
    return { ok: false, reason: `Sorry, we do not deliver to ${dest.state?.trim() || 'this state'} yet.` }
  }
  if (blocked.length > 0 && pin && blocked.some(b => pin.startsWith(b))) {
    return { ok: false, reason: `Sorry, we do not deliver to PIN code ${pin} yet.` }
  }
  return { ok: true }
}
