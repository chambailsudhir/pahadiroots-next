/**
 * vercel.json crons must stay in sync with the cron routes (Oct 2026 audit: the email dead-letter
 * retry route documented itself as "wired to a Vercel Cron job" but was never scheduled, so failed
 * emails, including payment confirmations, were never retried).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'

const root = join(__dirname, '..', '..')
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as {
  crons?: Array<{ path: string; schedule: string }>
  functions?: Record<string, { maxDuration?: number }>
}
const cronDir = join(root, 'src', 'app', 'api', 'v1', 'cron')

describe('vercel.json crons', () => {
  const scheduled = (vercel.crons ?? []).map(c => c.path)

  it('every cron route under api/v1/cron is scheduled', () => {
    const routes = readdirSync(cronDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && existsSync(join(cronDir, d.name, 'route.ts')))
      .map(d => `/api/v1/cron/${d.name}`)
    expect(routes.length).toBeGreaterThan(0)
    for (const r of routes) expect(scheduled, `${r} has a route but no entry in vercel.json crons`).toContain(r)
  })

  it('every scheduled path has a route file', () => {
    for (const path of scheduled) {
      const file = join(root, 'src', 'app', path.replace(/^\//, ''), 'route.ts')
      expect(existsSync(file), `${path} is scheduled but ${file} does not exist`).toBe(true)
    }
  })

  it('keeps at most 2 crons and every schedule is a valid 5-field expression', () => {
    expect((vercel.crons ?? []).length).toBeLessThanOrEqual(2)
    for (const c of vercel.crons ?? []) {
      const fields = c.schedule.split(' ')
      expect(fields, `${c.path}: "${c.schedule}" is not a 5-field cron`).toHaveLength(5)
      expect(fields.every(f => /^[\d,*/-]+$/.test(f)), `${c.path}: "${c.schedule}" has an invalid field`).toBe(true)
    }
  })

  // AUDIT S1-003: an abandoned online order holds stock, coupon and loyalty points until this sweep
  // releases it. On a daily schedule the admin-facing "30 minutes" promise is really up to ~24.5 h.
  // OWNER DECISION (recorded, not taken by the code): Vercel Hobby only accepts daily crons and the
  // build REJECTS sub-daily schedules, so vercel.json keeps the Hobby-safe daily sweep and
  // vercel.pro.json carries the 10-minute sweep to swap in after a plan upgrade. Until then the
  // CRON_SECRET-protected route must be called every 5-10 min by an external scheduler
  // (see src/app/api/v1/cron/expire-pending-orders/route.ts + lib/server/cronAuth.ts).
  // This test locks BOTH files so neither drifts.
  it('S1-003: the Pro variant sweeps at least every 15 minutes and the Hobby file stays daily-valid', () => {
    const pro = JSON.parse(readFileSync(join(root, 'vercel.pro.json'), 'utf8')) as typeof vercel
    const proSweep = (pro.crons ?? []).find(c => c.path === '/api/v1/cron/expire-pending-orders')
    expect(proSweep, 'expire-pending-orders is not scheduled in vercel.pro.json').toBeDefined()
    const [min, hour] = proSweep!.schedule.split(' ')
    const everyN = /^\*\/(\d+)$/.exec(min)
    expect(everyN, `minute field "${min}" must be */N`).not.toBeNull()
    expect(Number(everyN![1])).toBeLessThanOrEqual(15)
    expect(hour, 'the sweep must run every hour of the day').toBe('*')
    const hobbySweep = (vercel.crons ?? []).find(c => c.path === '/api/v1/cron/expire-pending-orders')
    expect(hobbySweep, 'expire-pending-orders is not scheduled in vercel.json').toBeDefined()
    expect(hobbySweep!.schedule.split(' ')[1], 'Hobby file must stay a once-a-day cron (plan constraint)').not.toBe('*')
    // Everything except the sweep schedule must be identical between the two files.
    const strip = (j: typeof vercel) => JSON.stringify({ ...j, crons: (j.crons ?? []).filter((c: { path: string }) => c.path !== '/api/v1/cron/expire-pending-orders') })
    expect(strip(pro)).toBe(strip(vercel))
  })

  it('scheduled functions have a maxDuration of 30s or less', () => {
    for (const [file, cfg] of Object.entries(vercel.functions ?? {})) {
      if (file.includes('/cron/')) expect(cfg.maxDuration ?? 10).toBeLessThanOrEqual(30)
    }
  })
})
