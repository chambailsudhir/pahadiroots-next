import { describe, it, expect } from 'vitest'

import { stripServerOnlySettings, SERVER_ONLY_SETTING_KEYS } from '@/lib/siteSettingsHelpers'
describe('stripServerOnlySettings (keeps admin-only keys out of client component props)', () => {
  it('removes the admin notification address and email switch, keeps everything else', () => {
    const input = { whatsapp_number: '91999', admin_notify_email: 'ops@example.com', order_email_enabled: 'true', fssai_license: '123' }
    const out = stripServerOnlySettings(input)
    expect(out).toEqual({ whatsapp_number: '91999', fssai_license: '123' })
    for (const k of SERVER_ONLY_SETTING_KEYS) expect(k in out).toBe(false)
  })
  it('does not mutate the original object (server code still needs the keys)', () => {
    const input = { admin_notify_email: 'ops@example.com' }
    stripServerOnlySettings(input)
    expect(input.admin_notify_email).toBe('ops@example.com')
  })
})
