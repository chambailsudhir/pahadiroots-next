// lib/server/returnEvidence.ts — return-evidence photos in the PRIVATE `return-evidence` bucket (ACC-051).
//
// Photos live in a private bucket (db_migration_v18_private_return_evidence_bucket.sql): no public URL, no listing.
// VERIFY ROUND (L-8): returns.photo_urls used to hold read links signed for ONE YEAR at submission time — any copy of such a
// link (an admin's browser history, a forwarded data export, a log) stayed a valid key to the customer's photo for a year.
// Now the column holds the bare OBJECT PATHS (returns/<orderId>/<n>-<name>) and a SHORT-LIVED signed link is minted every
// time someone entitled reads them (the customer's data export; the admin panel's `return_evidence_links` action).
// Rows written before this change still hold full signed links; `evidenceReadLinks` keeps them working as they are.
//
// Signing an object also proves it really exists (Storage refuses to sign a missing object), so a made-up path can never be
// attached as "evidence" — that is what `verifyEvidencePaths` relies on at submission time.
import 'server-only'

export const EVIDENCE_BUCKET = 'return-evidence'
/** A link lives only as long as one look at the photo needs. A new one is minted on every read. */
export const EVIDENCE_LINK_TTL_SECONDS = 15 * 60

type StorageEnv = { url: string; serviceKey: string }

/** True for a value stored before L-8 (a full signed link) — kept as it is, never re-signed. */
export function isLegacyEvidenceLink(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\//i.test(value)
}

/** The object path inside a legacy `/object/sign/return-evidence/<path>?token=` link, or null for any other link. */
export function legacyEvidencePath(link: string): string | null {
  const m = /\/storage\/v1\/object\/sign\/return-evidence\/([^?#]+)/.exec(link)
  if (!m) return null
  let path: string
  try { path = decodeURIComponent(m[1]) } catch { return null }
  return path && !path.includes('..') ? path : null
}

/** Signs ONE object; null when it is missing, the storage call fails, or the answer points anywhere else. */
async function signOne(path: string, env: StorageEnv, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(`${env.url}/storage/v1/object/sign/${EVIDENCE_BUCKET}/${path}`, {
      method:  'POST',
      headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ expiresIn: EVIDENCE_LINK_TTL_SECONDS }),
      signal:  AbortSignal.timeout(5_000),
    })
    if (!res.ok) return null                                      // missing object / storage error
    const { signedURL } = await res.json() as { signedURL?: unknown }
    // The link must be on this project's storage and for exactly the object we asked for.
    if (typeof signedURL !== 'string' || !signedURL.startsWith(`/object/sign/${EVIDENCE_BUCKET}/${path}?token=`)) return null
    return `${env.url}/storage/v1${signedURL}`
  } catch { return null }                                         // one bad photo never blocks anything
}

/** Short-lived read links for the given object paths (missing / unsignable objects are dropped). */
export async function signEvidenceLinks(paths: string[], env: StorageEnv, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const links: string[] = []
  for (const path of paths) {
    const link = await signOne(path, env, fetchImpl)
    if (link) links.push(link)
  }
  return links
}

/**
 * Submission time: keeps only the paths whose object really exists in the private bucket (proven by signing it; the link
 * itself is thrown away). These bare paths are what gets stored in returns.photo_urls.
 */
export async function verifyEvidencePaths(paths: string[], env: StorageEnv, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const kept: string[] = []
  for (const path of paths) {
    if (await signOne(path, env, fetchImpl)) kept.push(path)
  }
  return kept
}

/**
 * Read time: turns whatever returns.photo_urls holds into links that work right now — a bare path is signed for
 * EVIDENCE_LINK_TTL_SECONDS, a legacy full link is passed through unchanged, anything else is dropped.
 */
export async function evidenceReadLinks(stored: unknown, env: StorageEnv, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  if (!Array.isArray(stored)) return []
  const links: string[] = []
  for (const value of stored) {
    if (isLegacyEvidenceLink(value)) {
      // Nov 2026 verification: a legacy link signed for a YEAR in this bucket is re-signed from its object path, so the
      // reader gets a 15-minute link and the year-long one stops being handed out. Anything else (an old public URL) as is.
      const legacyPath = legacyEvidencePath(value)
      const fresh = legacyPath ? await signOne(legacyPath, env, fetchImpl) : null
      links.push(fresh ?? value)
      continue
    }
    if (typeof value !== 'string' || !value || value.includes('..')) continue
    const link = await signOne(value, env, fetchImpl)
    if (link) links.push(link)
  }
  return links
}
