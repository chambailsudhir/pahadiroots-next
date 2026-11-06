/**
 * listingPagesStatic.test.ts — PERF FIX F-3 (listing pages were fully dynamic).
 *
 * Reading `searchParams` in a Server Component (page or generateMetadata) makes
 * Next render the route on EVERY request: `cache-control: private, no-store`,
 * `x-vercel-cache: MISS`, every visit and crawl hitting Supabase, and the
 * route's `export const revalidate` doing nothing. These five routes must stay
 * ISR: the query string is applied in the browser instead (SearchParamsBridge
 * → the listing client components). Source-level guard, same style as
 * ourPromisePages.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..')
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')
// Strip comments so the explanation of the fix does not trip the checks.
const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const ISR_PAGES = [
  'app/products/page.tsx',
  'app/collections/[slug]/page.tsx',
  'app/new-arrivals/page.tsx',
  'app/blog/page.tsx',
  'app/lab-reports/page.tsx',
]

describe('listing pages are served from the ISR cache (no request-time searchParams)', () => {
  it.each(ISR_PAGES)('%s never reads searchParams and keeps an ISR revalidate window', (rel) => {
    const c = code(read(rel))
    expect(c).not.toMatch(/searchParams/)
    expect(c).not.toMatch(/from 'next\/headers'/)
    expect(c).not.toMatch(/dynamic\s*=\s*'force-dynamic'/)
    expect(c).toMatch(/export const revalidate = \d+/)
  })

  it.each(ISR_PAGES)('%s applies the query string through the client bridge', (rel) => {
    const c = code(read(rel))
    expect(c).toMatch(/(ProductListingClient|CollectionListingClient|BlogListingClient|LabReportsClient)/)
  })

  it('only SearchParamsBridge touches useSearchParams, and it does so inside <Suspense>', () => {
    for (const rel of ['components/product/ProductListingClient.tsx', 'components/product/useBrowseListing.ts',
      'components/collections/CollectionListingClient.tsx', 'components/blog/BlogListingClient.tsx', 'components/lab-reports/LabReportsClient.tsx']) {
      expect(code(read(rel))).not.toMatch(/useSearchParams/)
    }
    const bridge = code(read('components/ui/SearchParamsBridge.tsx'))
    expect(bridge).toMatch(/useSearchParams\(\)/)
    expect(bridge).toMatch(/<Suspense fallback=\{null\}>/)
  })
})
