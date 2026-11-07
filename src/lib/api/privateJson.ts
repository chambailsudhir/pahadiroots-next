import { NextResponse } from 'next/server'

// NextResponse.json for a per-user route: always `Cache-Control: private, no-store` (Nov 2026 verification). Without it Next.js
// answers `public, max-age=0, must-revalidate`, which a shared cache (CDN / corporate proxy) may store. An explicit
// Cache-Control in `init.headers` still wins. Kept in its own tiny module (no server imports) so route tests that mock
// serverUtils wholesale do not have to know about it.
export const PRIVATE_NO_STORE: Readonly<Record<string, string>> = { 'Cache-Control': 'private, no-store' }

export function privateJson(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return NextResponse.json(data, { ...init, headers: { ...PRIVATE_NO_STORE, ...(init.headers ?? {}) } })
}
