/**
 * S4 — checkout stepper labels on small screens.
 * The old rule hid ALL labels with display:none (bare dots, no sign of where you are) and
 * display:none also removes text from screen readers. The current step keeps its visible label;
 * the others are hidden VISUALLY only.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const css = fs.readFileSync(path.join(__dirname, '..', 'components', 'checkout', 'checkout-stepper.css'), 'utf8')

describe('checkout-stepper.css — small-screen labels (S4)', () => {
  const small = css.slice(css.indexOf('@media (max-width: 480px)'))

  it('does not hide step labels with display:none (that also hides them from screen readers)', () => {
    expect(small).not.toMatch(/\.ck-crumb[^{]*span\s*\{\s*display:\s*none/)
  })

  it('keeps the CURRENT step label visible and visually-hides only the others (clip pattern)', () => {
    expect(css).toMatch(/\.ck-crumb:not\(\.ck-crumb--active\) span\s*\{[^}]*clip:\s*rect\(0 0 0 0\)/)
    expect(css).not.toMatch(/\.ck-crumb--active\) span[^{]*\{[^}]*display:\s*none/)
  })
})
