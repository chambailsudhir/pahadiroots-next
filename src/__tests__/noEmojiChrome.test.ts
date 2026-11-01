import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Audit HOME-014: header, product cards, mobile menu and footer use SVG icons, not emoji (emoji differ per OS and cannot be
// recoloured). Data-driven emoji (category/state emoji set by the admin) are content and are not covered here.
const files = ['components/layout/Header.tsx', 'components/layout/MobileMenu.tsx', 'components/product/ProductCard.tsx', 'components/product/QuickViewModal.tsx', 'components/cart/CartDrawer.tsx',
  // verification pass, 1 Nov 2026: icon-style emoji were still rendered on checkout, cart and the product page
  'components/checkout/AddressForm.tsx', 'components/checkout/SavedAddressSelector.tsx', 'components/checkout/OrderSummary.tsx', 'components/checkout/ShippingProgress.tsx',
  'components/checkout/CheckoutStepper.tsx', 'components/cart/CartSummary.tsx', 'components/product/PincodeRow.tsx']
// Emoji that only appear as the *input* of the emoji→icon map (LABEL_ICONS) are allowed: they are rendered through AdminIcon.
const chrome = /(?<!['"\u200d])[🔍❤🤍👤✨🛒👁📦☀🚚🔐🎉✓](?!['"])/u
describe('no emoji used as UI icons', () => {
  for (const f of files) it(f, () => {
    const code = readFileSync(join(__dirname, '..', f), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join('\n')
    expect(code.match(chrome)).toBeNull()
  })
})
