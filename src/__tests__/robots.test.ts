/**
 * Nov 2026 verification: /maintenance was robots-disallowed while the store-closed gate redirected every page there, so a
 * crawler saw each URL 307 into a blocked URL. The gate now answers 503 in place and /maintenance is noindex on its own.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/getSiteSettings', () => ({ getSiteSettings: vi.fn(async () => ({})) }))

import robots from '@/app/robots'
import { metadata as maintenanceMeta } from '@/app/maintenance/page'

describe('robots.txt', () => {
  it('no longer disallows /maintenance, still blocks /api, /checkout and /order-success', () => {
    const rules = robots().rules
    const disallow = (Array.isArray(rules) ? rules[0] : rules).disallow
    expect(disallow).not.toContain('/maintenance')
    expect(disallow).toEqual(expect.arrayContaining(['/api/', '/checkout', '/order-success']))
  })
  it('/maintenance carries its own noindex instead', () => {
    expect(maintenanceMeta.robots).toEqual({ index: false, follow: false })
  })
})
