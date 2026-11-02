// Nov 2026 audit: every form field was 14px, so iPhone Safari zoomed the page on each tap. A global ≤640px rule sets 16px.
// This guards the rule against being deleted in a CSS clean-up (jsdom cannot compute real layout, so the stylesheet is read directly).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

describe('iOS input-zoom guard', () => {
  const block = css.match(/@media \(max-width: 640px\) \{\s*input:not\(\[type='checkbox'\]\)[\s\S]*?\n\}/)?.[0] ?? ''
  it('has a phone-width rule that sets text/select/textarea fields to 16px', () => {
    expect(block).not.toBe('')
    expect(block).toMatch(/font-size:\s*16px\s*!important/)
    for (const sel of ['select', 'textarea', "input:not([type='checkbox'])"]) expect(block).toContain(sel)
  })
  it('does not shrink checkboxes / radios / hidden inputs', () => {
    for (const t of ['checkbox', 'radio', 'hidden']) expect(block).toContain(`[type='${t}']`)
  })
})
