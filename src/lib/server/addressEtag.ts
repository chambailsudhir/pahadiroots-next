import { createHash } from 'node:crypto'

// ─────────────────────────────────────────────────────────────────────────────
// Version fingerprint of a customer's saved-address list (account audit, Nov 2026 — ACC-043b).
//
// The account UI saves addresses by sending the WHOLE list; the server replaces the stored list with it. Two tabs (or a
// phone and a laptop) editing at once therefore overwrite each other: whoever saves last wins and the other change is
// silently lost. GET /api/profile now returns this fingerprint, the client sends back the one it last saw, and POST
// refuses (409) when the stored list changed in between.
//
// It hashes the CONTENT of the rows — not updated_at, which the upsert does not bump on edit.
// ─────────────────────────────────────────────────────────────────────────────
export interface EtagRow {
  id?: unknown; label?: unknown; name?: unknown; phone?: unknown
  addr?: unknown; city?: unknown; state?: unknown; pin?: unknown
}

export function addressesEtag(rows: EtagRow[] | null | undefined): string {
  const canon = (rows ?? [])
    .map(r => [r.id, r.label, r.name, r.phone, r.addr, r.city, r.state, r.pin].map(v => String(v ?? '')).join('\u001f'))
    .sort()
    .join('\u001e')
  return createHash('sha1').update(canon).digest('hex').slice(0, 16)
}

export const ADDRESS_SELECT = 'id,label,name,phone,addr,city,state,pin'
