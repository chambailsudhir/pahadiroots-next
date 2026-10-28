/**
 * storeDataRouteRemoved.test.ts
 *
 * AUDIT S1-001 — GET /api/v1/store-data returned un-scrubbed service-key rows
 * (products select=*: cost_price, margin, vendor ids; ALL site_settings
 * including admin_notify_email; raw product_variants; team_members) to any
 * unauthenticated caller, CDN-cached and excluded from the proxy rate limit.
 * No component in src/ called it (only comments referenced it), so it was
 * live dead weight. The route file was deleted rather than scrubbed.
 *
 * This guard records the deletion: it fails if anyone re-creates the route
 * or re-introduces a client fetch of it without going through a scrubbed,
 * purpose-built endpoint (cart-settings / cart-upsells / search-catalog).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      walk(full, out)
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

describe('/api/v1/store-data is gone (AUDIT S1-001)', () => {
  it('the route file no longer exists', () => {
    expect(existsSync(path.join(SRC, 'app/api/v1/store-data/route.ts'))).toBe(false)
    expect(existsSync(path.join(SRC, 'app/api/v1/store-data/route.js'))).toBe(false)
  })

  it('nothing in src/ fetches /api/v1/store-data any more (comments excluded)', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const code = readFileSync(file, 'utf8')
        .split('\n')
        .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line)) // drop comment lines
        .join('\n')
      if (/fetch\([^)]*['"`][^'"`]*\/api\/v1\/store-data/.test(code) || /['"`]\/api\/v1\/store-data['"`]/.test(code)) {
        offenders.push(path.relative(SRC, file))
      }
    }
    // proxy.ts still lists the path in its matcher exclusion regex — that is a
    // route-matching string, not a call, and is outside this track's files.
    expect(offenders.filter(f => f !== 'proxy.ts')).toEqual([])
  })
})
