/**
 * Test double for '@/lib/api/rateLimitKv' (the real one talks to Upstash / Postgres).
 * Same fixed-count semantics: INCR, allowed while count <= limit. Use in a test file with
 *   vi.mock('@/lib/api/rateLimitKv', async () => (await import('./helpers/inMemoryRateLimit')).rateLimitKvMock)
 */
import { vi } from 'vitest'

const counts = new Map<string, number>()

export const rateLimitKvMock = {
  checkRateLimitKv: vi.fn(async (key: string, limit: number) => {
    const n = (counts.get(key) ?? 0) + 1
    counts.set(key, n)
    return n <= limit
  }),
  peekRateLimitKv: vi.fn(async (key: string, limit: number) => (counts.get(key) ?? 0) >= limit),
}

export function resetInMemoryRateLimit() { counts.clear() }
export function rateLimitCount(key: string) { return counts.get(key) ?? 0 }
/** The live counter map, for tests that need to clear one limiter while keeping another. */
export function rateLimitCountsForTest() { return counts }
