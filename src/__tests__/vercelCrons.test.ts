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

  it('stays within Vercel Hobby limits: at most 2 crons, none more frequent than daily', () => {
    expect((vercel.crons ?? []).length).toBeLessThanOrEqual(2)
    for (const c of vercel.crons ?? []) {
      const [min, hour, dom, mon, dow] = c.schedule.split(' ')
      expect(/^\d+$/.test(min) && /^\d+$/.test(hour), `${c.path}: "${c.schedule}" runs more than once a day`).toBe(true)
      expect([dom, mon, dow].every(f => f === '*' || /^[\d,*/-]+$/.test(f))).toBe(true)
    }
  })

  it('scheduled functions have a maxDuration of 30s or less', () => {
    for (const [file, cfg] of Object.entries(vercel.functions ?? {})) {
      if (file.includes('/cron/')) expect(cfg.maxDuration ?? 10).toBeLessThanOrEqual(30)
    }
  })
})
