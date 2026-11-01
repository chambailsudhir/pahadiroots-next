import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join } from 'path'

const root = join(__dirname, '../app')
function walk(d: string): string[] {
  return readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [] })
}

describe('share (Open Graph) images', () => {
  it('ships a real 1200x630 branded default image', () => {
    const f = join(__dirname, '../../public/og-default.jpg')
    expect(existsSync(f)).toBe(true)
    const b = readFileSync(f)
    expect(b.length).toBeLessThan(300_000)
    // JPEG SOF0/SOF2 marker carries height then width
    let i = 2, w = 0, h = 0
    while (i < b.length) { if (b[i] !== 0xff) { i++; continue } const m = b[i + 1]; if (m === 0xc0 || m === 0xc2) { h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); break } i += 2 + b.readUInt16BE(i + 2) }
    expect([w, h]).toEqual([1200, 630])
  })
  it('no page declares the square logo as a 1200x630 share image', () => {
    const bad = walk(root).filter(p => /url:\s*'\/logo\.png'[^\n]*width:\s*1200/.test(readFileSync(p, 'utf8')))
    expect(bad).toEqual([])
  })
})
