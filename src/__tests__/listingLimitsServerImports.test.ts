import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'

// Nov 2026 verification: a Server Component that imports a NON-component export (a constant, a helper) from a
// 'use client' module receives a client reference instead of the value. `all.slice(0, LISTING_PAGE_SIZE)` became
// `slice(0, NaN)` = [] and /products, /new-arrivals, /collections/<slug> and /blog shipped with no products or posts.
// This scans every server file under src/app and fails if it imports a named binding from a 'use client' module.

const ROOT = process.cwd()
const isClient = (src: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(src)

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p)
  }
  return out
}

function resolveImport(spec: string, from: string): string | null {
  const base = spec.startsWith('@/') ? join(ROOT, 'src', spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null
  if (!base) return null
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}

describe('server pages never import values from client modules', () => {
  it('no named (non-type) import from a "use client" module in a server file under src/app', () => {
    const offenders: string[] = []
    for (const file of walk(join(ROOT, 'src/app'))) {
      const src = readFileSync(file, 'utf8')
      if (isClient(src) || /route\.(t|j)s$/.test(file)) continue
      for (const m of src.matchAll(/import\s+(?!type\b)([^'";]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
        const named = /\{([^}]*)\}/.exec(m[1])?.[1]
        if (!named) continue
        // Components (PascalCase) are fine to import from a client module; constants (UPPER_CASE) and helpers (camelCase) are not.
        const isComponentName = (n: string) => /^[A-Z][a-z0-9]/.test(n) && !/^[A-Z0-9_]+$/.test(n)
        const values = named.split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(s => s && !s.startsWith('type ') && !isComponentName(s))
        if (values.length === 0) continue
        const target = resolveImport(m[2], file)
        if (target && isClient(readFileSync(target, 'utf8'))) offenders.push(`${file.replace(ROOT + '/', '')}: { ${values.join(', ')} } from ${m[2]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
