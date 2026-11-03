import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'

// A vercel.json that fails Vercel's schema validation ERRORS the deployment (it did: ignoreCommand > 256 chars broke a production deploy).
describe.each(['vercel.json', 'vercel.pro.json'])('%s', (file) => {
  const cfg = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  it('ignoreCommand respects the 256-character schema limit and points at an existing script', () => {
    const cmd = String(cfg.ignoreCommand ?? '')
    expect(cmd.length).toBeGreaterThan(0)
    expect(cmd.length).toBeLessThanOrEqual(256)
    expect(existsSync('scripts/vercel-ignore.sh')).toBe(true)
  })
  it('buildCommand / installCommand also stay within 256 characters', () => {
    for (const k of ['buildCommand', 'installCommand']) if (cfg[k]) expect(String(cfg[k]).length).toBeLessThanOrEqual(256)
  })
})

describe('scripts/vercel-ignore.sh', () => {
  const run = (env: Record<string, string>) => spawnSync('sh', ['scripts/vercel-ignore.sh'], { env: { PATH: process.env.PATH ?? '', ...env } }).status
  it('skips previews, builds when it cannot compare', () => {
    expect(run({ VERCEL_ENV: 'preview' })).toBe(0)
    expect(run({ VERCEL_ENV: 'production' })).toBe(1)                                                    // no previous sha
    expect(run({ VERCEL_ENV: 'production', VERCEL_GIT_PREVIOUS_SHA: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' })).toBe(1)   // unknown sha
  })
  it('skips only when nothing outside docs / md / tests / .github changed since the previous deploy', () => {
    const head = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim()
    expect(run({ VERCEL_ENV: 'production', VERCEL_GIT_PREVIOUS_SHA: head })).toBe(0)                  // identical => nothing to build
  })
})
