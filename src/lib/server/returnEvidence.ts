// lib/server/returnEvidence.ts — read links for return-evidence photos (ACC-051).
//
// Photos live in the PRIVATE `return-evidence` bucket (db_migration_v18_private_return_evidence_bucket.sql): no public URL, no
// listing. When a return is submitted we turn each uploaded object path into a SIGNED read link and store that in
// returns.photo_urls — the admin panel renders that column as plain links, so it keeps working with no change, but a link is an
// unguessable, expiring capability instead of a permanent public address. Signing also proves the object really exists
// (Storage refuses to sign a missing object), so a made-up path can never be attached as "evidence".
import 'server-only'

export const EVIDENCE_BUCKET = 'return-evidence'
/** Long enough for the whole return / refund / dispute window; a new link can always be signed for an older return. */
export const EVIDENCE_LINK_TTL_SECONDS = 365 * 24 * 3600

export async function signEvidenceLinks(
  paths: string[],
  env: { url: string; serviceKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const links: string[] = []
  for (const path of paths) {
    try {
      const res = await fetchImpl(`${env.url}/storage/v1/object/sign/${EVIDENCE_BUCKET}/${path}`, {
        method:  'POST',
        headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ expiresIn: EVIDENCE_LINK_TTL_SECONDS }),
        signal:  AbortSignal.timeout(5_000),
      })
      if (!res.ok) continue                                     // missing object / storage error → not attached
      const { signedURL } = await res.json() as { signedURL?: unknown }
      // The link must be on this project's storage and for exactly the object we asked for.
      if (typeof signedURL !== 'string' || !signedURL.startsWith(`/object/sign/${EVIDENCE_BUCKET}/${path}?token=`)) continue
      links.push(`${env.url}/storage/v1${signedURL}`)
    } catch { /* one bad photo never blocks the return */ }
  }
  return links
}
