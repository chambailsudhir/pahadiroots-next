import { describe, it, expect, vi, afterEach } from 'vitest'
import { adminNotifyAddress } from '@/lib/server/adminNotify'

afterEach(() => { vi.unstubAllEnvs() })

describe('adminNotifyAddress — who gets "new order" e-mails', () => {
  it('the admin setting wins when it is a real address', () => {
    vi.stubEnv('ADMIN_EMAIL', 'env@shop.test')
    expect(adminNotifyAddress({ admin_notify_email: ' owner@shop.test ' })).toBe('owner@shop.test')
  })
  it('falls back to ADMIN_EMAIL when the setting was never filled in (the production case: the owner got NO new-order e-mails)', () => {
    vi.stubEnv('ADMIN_EMAIL', 'env@shop.test')
    expect(adminNotifyAddress({})).toBe('env@shop.test')
    expect(adminNotifyAddress(null)).toBe('env@shop.test')
    expect(adminNotifyAddress({ admin_notify_email: 'not-an-email' })).toBe('env@shop.test')
  })
  it('returns empty (no send) when neither is a valid address', () => {
    vi.stubEnv('ADMIN_EMAIL', '')
    expect(adminNotifyAddress({})).toBe('')
  })
})
