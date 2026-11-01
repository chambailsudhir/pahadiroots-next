import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join } from 'path'

const src = join(__dirname, '..')
const walk = (d: string): string[] => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(n) ? [p] : [] })

describe('fonts (audit HOME-012): two self-hosted families, nothing fetched from Google at build time', () => {
  const files = walk(src).filter(p => !p.includes('__tests__'))
  it('no module imports next/font/google (a transient Google outage failed a production deploy)', () => {
    expect(files.filter(p => /next\/font\/google/.test(readFileSync(p, 'utf8')).valueOf() && !/^\s*\/\//.test('')).filter(p => /from ['"]next\/font\/google['"]/.test(readFileSync(p, 'utf8')))).toEqual([])
  })
  it('every font file referenced by the layout exists', () => {
    const layout = readFileSync(join(src, 'app/layout.tsx'), 'utf8')
    const paths = [...layout.matchAll(/path:\s*'(\.\.\/fonts\/[^']+)'/g)].map(m => m[1])
    expect(paths.length).toBeGreaterThanOrEqual(5)
    for (const p of paths) expect(existsSync(join(src, 'app', p))).toBe(true)
  })
  it('stylesheets only name the two shipped families', () => {
    const css = files.filter(p => p.endsWith('.css')).map(p => readFileSync(p, 'utf8')).join('\n')
    expect(css).not.toMatch(/--font-(inter|cormorant|region-serif|region-sans)|Source Serif|Montserrat|Cormorant/)
  })
})
