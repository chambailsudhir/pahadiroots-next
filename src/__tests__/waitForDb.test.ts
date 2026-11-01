import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { waitForDb } = require('../../scripts/wait-for-db.cjs') as { waitForDb: (o: Record<string, unknown>) => Promise<boolean> }

const ok = () => Promise.resolve({ ok: true } as Response)
const down = () => Promise.reject(new Error('timeout'))
function clock() { let t = 0; return { now: () => t, sleep: async (ms: number) => { t += ms } } }
const base = () => ({ url: 'https://x.supabase.co', key: 'k', totalMs: 60_000, everyMs: 10_000, log: () => {}, ...clock() })

describe('wait-for-db (runs before next build)', () => {
  it('passes straight away when the database answers', async () => {
    const f = vi.fn(ok)
    expect(await waitForDb({ ...base(), fetchImpl: f })).toBe(true)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('rides out a short blip: retries until it answers', async () => {
    const f = vi.fn().mockImplementationOnce(down).mockImplementationOnce(down).mockImplementation(ok)
    expect(await waitForDb({ ...base(), fetchImpl: f })).toBe(true)
    expect(f).toHaveBeenCalledTimes(3)
  })
  it('treats an error response (5xx) as "not ready"', async () => {
    const f = vi.fn().mockResolvedValueOnce({ ok: false } as Response).mockImplementation(ok)
    expect(await waitForDb({ ...base(), fetchImpl: f })).toBe(true)
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('gives up with a failure (stops the build) when it never answers within the budget', async () => {
    const f = vi.fn(down)
    expect(await waitForDb({ ...base(), fetchImpl: f })).toBe(false)
    expect(f.mock.calls.length).toBeGreaterThan(1)
  })
  it('does nothing (never blocks a build) when the Supabase env vars are absent', async () => {
    const f = vi.fn(down)
    expect(await waitForDb({ ...base(), url: undefined, key: undefined, fetchImpl: f })).toBe(true)
    expect(f).not.toHaveBeenCalled()
  })
})
