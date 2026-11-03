import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { ok, fail } from '@/lib/api/serverUtils'

describe('shared API response helpers are never cacheable by a shared cache', () => {
  it('ok() answers private, no-store', () => { expect(ok({ a: 1 }).headers.get('cache-control')).toBe('private, no-store') })
  it('fail() answers private, no-store and keeps extra headers', () => {
    const r = fail(429, 'slow down', { 'Retry-After': '60' })
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(r.headers.get('retry-after')).toBe('60')
    expect(r.status).toBe(429)
  })
  it('a caller can still override the cache header explicitly', () => {
    expect(fail(400, 'x', { 'Cache-Control': 'public, max-age=60' }).headers.get('cache-control')).toBe('public, max-age=60')
  })
})
