/** ACC-021 — cached same-origin pincode lookup (replaces the browser → api.postalpincode.in call). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import fs from 'node:fs'

const fetchMock = vi.fn()
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })

let ip = 1
const call = (pin: string) => import('@/app/api/v1/pincode/[pin]/route').then(({ GET }) =>
  GET(new NextRequest(`https://pahadiroots.com/api/v1/pincode/${pin}`, { headers: { 'x-forwarded-for': `198.51.100.${ip++}` } }), { params: Promise.resolve({ pin }) }))
const upstream = (body: unknown, ok = true) => fetchMock.mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body })

describe('GET /api/v1/pincode/[pin]', () => {
  it.each(['12345', 'abcdef', '012345', '1234567', ''])('400s for %j without calling the upstream', async (pin) => {
    expect((await call(pin)).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards only the four fields the forms use, capped, and caches for 30 days', async () => {
    upstream([{ Status: 'Success', Message: 'x', PostOffice: [{ Name: 'Dehradun GPO', District: 'Dehradun', Block: 'Dehradun', State: 'Uttarakhand', Pincode: '248001', Secret: 'drop-me' }] }])
    const res = await call('248001')
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body[0].PostOffice[0]).toEqual({ Name: 'Dehradun GPO', District: 'Dehradun', Block: 'Dehradun', State: 'Uttarakhand' })
    expect(res.headers.get('Cache-Control')).toMatch(/s-maxage=2592000/)
  })

  it('a genuine "No records found" keeps the upstream shape and is cached only briefly', async () => {
    upstream([{ Status: 'Error', Message: 'No records found', PostOffice: null }])
    const res = await call('999999')
    expect((await res.json())[0].PostOffice).toBeNull()
    expect(res.headers.get('Cache-Control')).toMatch(/s-maxage=3600/)
  })

  it.each([
    [[{ Status: 'Error', PostOffice: null }]],
    [[{ Status: 'Error', Message: 'Too many requests', PostOffice: null }]],
    [[{ Status: 'Success', PostOffice: [] }]],
    [[]],
    [{ message: 'overloaded' }],
  ])('an upstream 200 whose body is an error (%j) is a 502 and is NOT cached', async (body) => {
    upstream(body)
    const res = await call('248001')
    expect(res.status).toBe(502); expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('does not use the 30-day Next data cache for the upstream fetch', async () => {
    upstream([{ Status: 'Success', PostOffice: [{ Name: 'a', District: 'b', Block: 'c', State: 'd' }] }])
    await call('248001')
    const init = fetchMock.mock.calls[0][1]
    expect(init.cache).toBe('no-store'); expect(init.next).toBeUndefined()
  })

  it('an upstream failure or timeout is a 502 that is NEVER cached (so the next try retries)', async () => {
    upstream({}, false)
    let res = await call('248001')
    expect(res.status).toBe(502); expect(res.headers.get('Cache-Control')).toBe('no-store')

    fetchMock.mockRejectedValue(new DOMException('timeout', 'TimeoutError'))
    res = await call('248001')
    expect(res.status).toBe(502); expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('rate-limits a single IP', async () => {
    upstream([{ Status: 'Error', Message: 'No records found', PostOffice: null }])
    const { GET } = await import('@/app/api/v1/pincode/[pin]/route')
    let last = 200
    for (let i = 0; i < 70; i++) {
      last = (await GET(new NextRequest('https://pahadiroots.com/api/v1/pincode/248001', { headers: { 'x-forwarded-for': '203.0.113.9' } }), { params: Promise.resolve({ pin: '248001' }) })).status
    }
    expect(last).toBe(429)
  })

  it('the third-party host is gone from the CSP and from the form', () => {
    expect(fs.readFileSync('src/lib/csp.js', 'utf8')).not.toContain('postalpincode')
    expect(fs.readFileSync('src/components/checkout/AddressForm.tsx', 'utf8')).not.toMatch(/https:\/\/api\.postalpincode/)
  })
})
