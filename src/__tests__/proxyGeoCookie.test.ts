import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api/rateLimitKv', () => ({ checkRateLimitKv: async () => true }))
import { proxy } from '@/proxy'

const page = (country?: string, cookie?: string) =>
  new NextRequest('https://www.pahadiroots.com/', { headers: { ...(country ? { 'x-vercel-ip-country': country } : {}), ...(cookie ? { cookie } : {}) } })

describe('proxy hv_geo cookie (drives the region-aware consent banner)', () => {
  it('sets eu / row / unk from the Vercel country header on page requests', async () => {
    expect((await proxy(page('DE'))).cookies.get('hv_geo')?.value).toBe('eu')
    expect((await proxy(page('IN'))).cookies.get('hv_geo')?.value).toBe('row')
    expect((await proxy(page())).cookies.get('hv_geo')?.value).toBe('unk')
  })
  it('does not rewrite the cookie when it already matches (no extra Set-Cookie)', async () => {
    expect((await proxy(page('IN', 'hv_geo=row'))).cookies.get('hv_geo')).toBeUndefined()
  })
})
