// Pure helpers shared by the review submission route, the eligibility route and the review-request e-mail.

export const REVIEW_MAX_CHARS = 1000

/** Strip HTML tags and trim. Same rule the rest of the storefront applies before storing customer text. */
export function stripTags(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim()
}

/** Review body: tags stripped, trimmed, capped at 1000 characters. Empty -> null. */
export function cleanReviewComment(raw: string | null | undefined): string | null {
  if (!raw) return null
  const t = stripTags(String(raw)).slice(0, REVIEW_MAX_CHARS).trim()
  return t || null
}

/**
 * Public display name built SERVER-SIDE from the customer record: first name + last initial ("Priya S.").
 * Never taken from the request body, so a reviewer cannot impersonate anyone.
 */
export function reviewerDisplayName(first: unknown, last: unknown): string {
  const f = typeof first === 'string' ? (stripTags(first).split(/\s+/)[0] ?? '') : ''
  const l = typeof last === 'string' ? stripTags(last) : ''
  const initial = l ? (Array.from(l)[0] ?? '').toUpperCase() : ''
  const name = f.slice(0, 40)
  if (!name) return 'Customer'
  return initial ? `${name} ${initial}.` : name
}

/** A review row is shown as "Verified purchase" only when the flag is literally true (absent before the migration). */
export function isVerifiedReview(r: unknown): boolean {
  return !!r && typeof r === 'object' && (r as { is_verified_purchase?: unknown }).is_verified_purchase === true
}
