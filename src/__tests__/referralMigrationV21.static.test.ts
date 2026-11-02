/** Static guard for db_migration_v21_referral_hardening.sql (cannot run SQL in unit tests; see the .rollback_test.sql). */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { normalizeReferralCode } from '@/lib/referral'

const sql = fs.readFileSync('db_migration_v21_referral_hardening.sql', 'utf8')

describe('referral v21 migration', () => {
  it('is flagged as needing a diff against the live source', () => {
    expect(sql).toMatch(/MUST BE DIFFED AGAINST THE LIVE FUNCTION SOURCE/)
  })
  it('keeps signatures and service_role-only privileges', () => {
    expect(sql).toContain('attach_referral(p_referee_id bigint, p_code text)')
    expect(sql).toContain('process_referral_rewards(p_limit integer DEFAULT 50)')
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.attach_referral\(bigint, text\)\s+FROM PUBLIC, anon, authenticated/)
    expect(sql).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.process_referral_rewards\(integer\)\s+TO service_role/)
    expect(sql).not.toMatch(/GRANT[^;]*TO (anon|authenticated|PUBLIC)/)
  })
  it('locks the customers rows before the caps are counted', () => {
    const lock = sql.indexOf('PERFORM 1 FROM customers WHERE id IN (r.referrer_id, r.referee_id) ORDER BY id FOR UPDATE')
    const cap = sql.indexOf("referral_max_per_month', 3")
    const count = sql.indexOf("status = 'rewarded' AND referrer_points > 0) < v_max_life")
    expect(lock).toBeGreaterThan(cap)        // after the settings are read…
    expect(lock).toBeLessThan(count)         // …but before the count
  })
  it('requires a delivered referrer order and covers saved addresses / aliases', () => {
    expect(sql).toMatch(/ro\.customer_id = r\.referrer_id[\s\S]*order_status::text = 'delivered'/)
    expect(sql).toContain('FROM saved_addresses')
    expect(sql).toContain('referral_email_norm')
  })
  it('generates random 12-char codes that the app regex accepts', () => {
    expect(sql).toContain('gen_random_uuid()')
    expect(sql).not.toMatch(/md5\(NEW\.id/)
    expect(normalizeReferralCode('a1b2c3d4e5f6')).toBe('A1B2C3D4E5F6')
  })
})
