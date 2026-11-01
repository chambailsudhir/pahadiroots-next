import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Audit HOME-014: header, product cards, mobile menu and footer use SVG icons, not emoji (emoji differ per OS and cannot be
// recoloured). Data-driven emoji (category/state emoji set by the admin) are content and are not covered here.
const files = ['components/layout/Header.tsx', 'components/layout/MobileMenu.tsx', 'components/product/ProductCard.tsx', 'components/product/QuickViewModal.tsx', 'components/cart/CartDrawer.tsx']
const chrome = /[🔍❤🤍👤✨🛒👁📍📦☀]/u
describe('no emoji used as UI icons', () => {
  for (const f of files) it(f, () => {
    const code = readFileSync(join(__dirname, '..', f), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join('\n')
    expect(code.match(chrome)).toBeNull()
  })
})
