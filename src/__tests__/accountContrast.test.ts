import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(process.cwd(), 'src/app/account/styles/account.module.css'), 'utf8')

function lum(hex: string): number {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map(i => {
    const v = parseInt(f.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
function colourOf(sel: string): string {
  const esc = sel.replace(/[.:]/g, m => '\\' + m)
  const m = new RegExp('^' + esc + '\\s*\\{[^}]*?(?<![-\\w])color:\\s*(#[0-9a-fA-F]{3,6})', 'm').exec(css)
  if (!m) throw new Error('no colour for ' + sel)
  return m[1]
}
/** white at alpha over an opaque colour */
function over(alpha: number, bg: string): string {
  const h = bg.replace('#', '')
  const c = [0, 2, 4].map(i => Math.round(255 * alpha + parseInt(h.slice(i, i + 2), 16) * (1 - alpha)))
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('')
}

// [selector, backgrounds it is rendered on]
const PAIRS: [string, string[]][] = [
  ['.errTxt', ['#ffffff']],
  ['.badgePending', ['#fff8e1']],
  ['.lyRefSub', ['#fffbe8', '#fff9dc']],
  ['.lyTxnDate', ['#ffffff']],
  ['.ordersSearch::placeholder', ['#fafaf8', '#ffffff']],
  ['.loadingText', ['#f4f0eb']],
  ['.odAddrPhone', ['#ffffff']],
  ['.wlCount', ['#f4f0eb', '#ffffff']],
  ['.wlEmptyMsg', ['#f4f0eb', '#ffffff']],
  ['.saEmptyMsg', ['#f4f0eb', '#ffffff']],
  ['.soOrderDate', ['#ffffff']],
  ['.saCardSub', ['#ffffff']],
  ['.saActBtn', ['#ffffff']],
  ['.saDelCancelBtn', ['#ffffff']],
  ['.pwStrengthLbl', ['#ffffff']],
  ['.odErrorMsg', ['#f4f0eb']],
  ['.saAuthMsg', ['#f4f0eb', '#ffffff']],
  ['.ocImgMore', ['#f5f0e8']],
  ['.wlClearBtn', ['#f4f0eb', '#ffffff']],
]

describe('account.module.css text contrast (WCAG AA 4.5:1)', () => {
  for (const [sel, bgs] of PAIRS) {
    it(`${sel}`, () => {
      const fg = colourOf(sel)
      for (const bg of bgs) expect(ratio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    })
  }
  it('.sbMember (translucent white) on the lightest part of the gradient', () => {
    const m = /^\.sbMember\s*\{[^}]*?color:\s*rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/m.exec(css)
    expect(m).toBeTruthy()
    const alpha = parseFloat(m![1])
    expect(ratio(over(alpha, '#3a6b40'), '#3a6b40')).toBeGreaterThanOrEqual(4.5)
  })
})
