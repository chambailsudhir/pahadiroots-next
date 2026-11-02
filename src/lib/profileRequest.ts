// ─────────────────────────────────────────────────────────────────────────────
// lib/profileRequest.ts — one GET /api/profile per login, not two (account audit, Nov 2026 — ACC-047)
//
// Live trace of a login: AuthModal pre-caches the profile for checkout (prefetchProfileToCache) and, a moment later,
// the account page's useAuth.init() asks for the same profile again (fetchProfile) — two identical, billed serverless
// calls on a database that already struggles. Both now go through this helper:
//   • a request that is already in flight is shared;
//   • a result that is only seconds old is reused (REUSE_MS), then forgotten;
//   • anything that changes or ends the session invalidates it (profile edit, logout / PII clear).
// The reused value is the same JSON the caller would have received, so behaviour is unchanged apart from the saved call.
// ─────────────────────────────────────────────────────────────────────────────

const REUSE_MS = 4_000

let inflight: Promise<unknown> | null = null
let lastValue: unknown = null
let lastAt = 0

export function sharedProfileRequest(fetcher: () => Promise<unknown>): Promise<unknown> {
  if (inflight) return inflight
  if (lastValue !== null && Date.now() - lastAt < REUSE_MS) return Promise.resolve(lastValue)
  const p = fetcher()
    .then(v => { lastValue = v; lastAt = Date.now(); return v })
    .finally(() => { if (inflight === p) inflight = null })
  inflight = p
  return p
}

/** Forget any shared/recent profile — call on profile edits, logout and account deletion. */
export function invalidateProfileRequest(): void {
  inflight = null
  lastValue = null
  lastAt = 0
}
