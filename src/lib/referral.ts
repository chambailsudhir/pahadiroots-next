// lib/referral.ts — pure helpers shared by the referral route and the browser (no server-only imports).
//
// A friend's link looks like  https://www.pahadiroots.com/?ref=ABCD1234 . The code is remembered in the browser for
// REF_TTL_DAYS and applied (once) as soon as the visitor has an account. The database decides whether it counts
// (db_migration_v17_referral_controls.sql: new customers only, never yourself, reward after delivery + return window…).

export const REF_STORAGE_KEY = 'pr_ref'
export const REF_TTL_DAYS = 30

/** Referral codes are 8 upper-case hex characters today; accept 6-12 letters/digits so a future format still works. */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const c = raw.trim().toUpperCase()
  return /^[A-Z0-9]{6,12}$/.test(c) ? c : null
}

export interface RefStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/** Remember `?ref=CODE` from the current URL. Returns the code remembered, or null. A later link replaces an earlier one. */
export function captureReferralFromSearch(search: string, storage: RefStorage, now = Date.now()): string | null {
  try {
    const code = normalizeReferralCode(new URLSearchParams(search).get('ref'))
    if (!code) return null
    storage.setItem(REF_STORAGE_KEY, JSON.stringify({ code, at: now }))
    return code
  } catch { return null }
}

/** The remembered code, if it is still fresh. */
export function readPendingReferral(storage: RefStorage, now = Date.now()): string | null {
  try {
    const raw = storage.getItem(REF_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { code?: unknown; at?: unknown }
    const code = normalizeReferralCode(parsed.code)
    const at   = typeof parsed.at === 'number' ? parsed.at : 0
    if (!code || now - at > REF_TTL_DAYS * 86_400_000) { storage.removeItem(REF_STORAGE_KEY); return null }
    return code
  } catch { return null }
}

export function clearPendingReferral(storage: RefStorage): void {
  try { storage.removeItem(REF_STORAGE_KEY) } catch { /* private mode */ }
}

/** Customer-facing wording for every reason attach_referral() can give. */
export const REFERRAL_MESSAGES: Record<string, string> = {
  invalid_code:     "That referral code isn't valid. Please check it and try again.",
  not_new_customer: 'Referral codes can only be used before your first order.',
  already_applied:  'A referral code has already been added to your account.',
  same_person:      "You can't use a code from your own phone number or e-mail.",
  own_code:         "You can't use your own referral code.",
  not_allowed:      "This account can't use a referral code.",
}
export function referralMessage(reason: string | undefined): string {
  return (reason && REFERRAL_MESSAGES[reason]) || "We couldn't apply that code."
}
