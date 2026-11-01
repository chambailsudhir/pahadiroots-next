import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', () => ({ getServiceClient: () => ({}), supabase: {} }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn() }))

import { getProductsWithImages } from '@/lib/storeData'

describe('getProductsWithImages with a partial catalogue (some reads timed out)', () => {
  it('never throws or returns undefined when parts are missing', () => {
    expect(getProductsWithImages({} as never)).toEqual([])
    expect(getProductsWithImages({ products: [{ id: 1, name: 'A' }] } as never)).toHaveLength(1)
    expect(getProductsWithImages({ products: undefined, product_images: [{ product_id: 1, image_url: 'x', sort_order: 0 }] } as never)).toEqual([])
  })
})
