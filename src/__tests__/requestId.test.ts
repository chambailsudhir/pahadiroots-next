/** AUDIT G2 B1: correlation id helpers. */
import { describe, it, expect } from 'vitest'
import { getRequestId, requestLogger, withRequestId } from '@/lib/logger'

describe('request id', () => {
  it('reuses x-vercel-id / x-request-id, else mints a uuid', () => {
    expect(getRequestId(new Headers({ 'x-vercel-id': 'bom1::abc-123' }))).toBe('bom1::abc-123')
    expect(getRequestId(new Headers({ 'x-request-id': 'r-1' }))).toBe('r-1')
    expect(getRequestId(new Headers({ 'x-request-id': '<bad value>' }))).toMatch(/^[0-9a-f-]{36}$/)
    expect(getRequestId(null)).toMatch(/^[0-9a-f-]{36}$/)
  })
  it('requestLogger carries the id and withRequestId sets the header', () => {
    const l = requestLogger('abc', { route: 'x' })
    expect(l.requestId).toBe('abc')
    const res = withRequestId(new Response('x'), 'abc')
    expect(res.headers.get('x-request-id')).toBe('abc')
  })
})
