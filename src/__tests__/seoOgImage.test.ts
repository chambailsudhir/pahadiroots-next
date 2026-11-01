// AUD-009: the Open Graph / Twitter share image of a product page is its FIRST gallery photo
// (same image the gallery and Product JSON-LD lead with), not the legacy products.image_url.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const page = readFileSync(join(process.cwd(), 'src/app/products/[slug]/page.tsx'), 'utf8')

describe('product page share image', () => {
  it('prefers the first gallery image, then image_url, then the logo', () => {
    expect(page).toMatch(/const \{ product, images \} = await fetchProductData\(slug\)\n\s+if \(!product\) return \{ title: 'Product Not Found' \}/)
    expect(page).toContain("url: firstGalleryImage || product.image_url || '/logo.png'")
  })
})
