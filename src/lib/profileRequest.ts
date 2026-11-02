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
//
// The state lives on globalThis, NOT in module variables: live testing showed the production bundle gives the two callers
// (AuthModal chunk, account chunk) separate copies of small shared modules, so module-level state was never actually shared.
// ─────────────────────────────────────────────────────────────────────────────

const REUSE_MS = 4_000

interface SharedState { inflight: Promise<unknown> | null; value: unknown; at: number }
const KEY = '__prProfileRequest'
function state(): SharedState {
  const g = globalThis as unknown as Record<string, SharedState | undefined>
  return (g[KEY] ??= { inflight: null, value: null, at: 0 })
}

export function sharedProfileRequest(fetcher: () => Promise<unknown>): Promise<unknown> {
  const s = state()
  if (s.inflight) return s.inflight
  if (s.value !== null && Date.now() - s.at < REUSE_MS) return Promise.resolve(s.value)
  const p: Promise<unknown> = fetcher()
    .then(v => { s.value = v; s.at = Date.now(); return v })
    .finally(() => { if (s.inflight === p) s.inflight = null })
  s.inflight = p
  return p
}

/** Forget any shared/recent profile — call on profile edits, logout and account deletion. */
export function invalidateProfileRequest(): void {
  const s = state()
  s.inflight = null; s.value = null; s.at = 0
}
