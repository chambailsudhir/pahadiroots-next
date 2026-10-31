import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Footer, FooterA/B/C and FooterShared render on the server. A Server Component cannot pass event handlers (onMouseEnter,
// onClick …) to a client component such as next/link — React throws "Event handlers cannot be passed to Client Component
// props". It only happens for the footer variant that is actually rendered, so a build can pass for months and then fail the
// first time the settings read times out and the default variant is used (production build failure, Oct 2026).
// Hover/focus styling must therefore be CSS.
const dir = join(__dirname, '../components/layout')
for (const f of ['Footer.tsx', 'FooterA.tsx', 'FooterB.tsx', 'FooterC.tsx', 'FooterShared.tsx']) {
  describe(f, () => {
    const src = readFileSync(join(dir, f), 'utf8')
    const isClient = /^\s*['"]use client['"]/.test(src)
    it('has no inline event handlers unless it is a client component', () => {
      if (!isClient) expect(src).not.toMatch(/\bon(Mouse\w+|Click|Focus|Blur|Change|Key\w+)=\{/)
    })
  })
}
