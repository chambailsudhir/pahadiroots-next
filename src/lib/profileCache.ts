/**
 * src/lib/profileCache.ts
 *
 * Single source of truth for the checkout profile cache (pr_checkout_profile).
 *
 * OLD SITE PATTERN  →  what we replicate here:
 *   saveAuthSession() wrote pr_auth_profile to localStorage at login time.
 *   prefillDelivery() read it instantly — zero network call, zero delay.
 *
 * NEW SITE PATTERN  (this file):
 *   prefetchProfileToCache() is called at:
 *     1. Email login (AuthModal.tsx)
 *     2. Google OAuth callback (GoogleAuthHandler.tsx)
 *     3. Every page load for already-logged-in users (ProfilePrefetcher.tsx)
 *
 *   checkout/page.tsx reads from this cache via readProfileCache().
 *   If cache is warm → form fills in the useState initializer (zero render delay).
 *   If cache is cold → checkout skeleton shows while fetch completes.
 */

export const PROFILE_CACHE_KEY = 'pr_checkout_profile'
export const PROFILE_CACHE_TTL = 30 * 60 * 1000 // 30 minutes

export interface CachedProfile {
  ts:        number
  profile:   any
  addresses: any[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseSavedAddresses(raw: string | undefined | null): any[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

/**
 * Build a CachedProfile entry from a raw API profile object.
 * Constructs the addresses array exactly as checkout/page.tsx expects it.
 */
export function buildCacheEntry(prof: any): CachedProfile {
  const fullName   = [prof.first_name, prof.last_name].filter(Boolean).join(' ')
  const cleanPhone = (prof.phone || '').replace(/^\+91/, '').replace(/\D/g, '').slice(-10)

  const defaultAddr = prof.address_line1 ? [{
    _isDefault: true,
    label:  'Home' as const,
    name:   fullName,
    addr:   prof.address_line1 || '',
    area:   '',
    city:   prof.city          || '',
    state:  prof.state         || '',
    pin:    prof.postal_code   || '',
    phone:  cleanPhone,
  }] : []

  const saved = parseSavedAddresses(prof.saved_addresses)
    .filter((a: any) => a.label !== 'Default')

  return {
    ts:        Date.now(),
    profile:   prof,
    addresses: [...defaultAddr, ...saved],
  }
}

// ─── Read / Write ──────────────────────────────────────────────────────────

/**
 * Read the checkout profile cache.
 * Returns null if missing or older than PROFILE_CACHE_TTL.
 */
export function readProfileCache(): CachedProfile | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY)
    if (!raw) return null
    const parsed: CachedProfile = JSON.parse(raw)
    if (!parsed?.ts || Date.now() - parsed.ts > PROFILE_CACHE_TTL) return null
    return parsed
  } catch { return null }
}

/** Write a CachedProfile entry to localStorage. */
export function writeProfileCache(entry: CachedProfile): void {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(entry)) } catch {}
}

/** Wipe the cache (call on logout). */
export function clearProfileCache(): void {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(PROFILE_CACHE_KEY) } catch {}
}

/** True when cache is missing or stale — i.e. a fetch is needed. */
export function isProfileCacheStale(): boolean {
  return readProfileCache() === null
}

// ─── Prefetch ──────────────────────────────────────────────────────────────

/**
 * Fetch /api/profile and write the result to the checkout cache.
 *
 * Call this fire-and-forget style. Safe to call from any client component:
 *   prefetchProfileToCache().catch(() => {})
 *
 * Returns the CachedProfile on success, null if the user is not logged in
 * or the API call fails.
 */
export async function prefetchProfileToCache(): Promise<CachedProfile | null> {
  try {
    const res = await fetch('/api/profile')
    if (!res.ok) return null
    const data = await res.json()
    if (!data.profile) return null
    const entry = buildCacheEntry(data.profile)
    writeProfileCache(entry)
    return entry
  } catch {
    return null
  }
}
