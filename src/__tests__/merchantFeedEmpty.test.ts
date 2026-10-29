import { describe, it, expect, vi } from 'vitest'

const state: { products: unknown[] | null; error: unknown } = { products: [], error: null }
vi.mock('@/lib/supabase', () => {
  const chain = (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, in: () => q,
      then: (res: any) => res(table === 'products' ? { data: state.products, error: state.error } : { data: [], error: null }),
    }
    return q
  }
  return { supabase: { from: (t: string) => chain(t) } }
})
import { GET } from '@/app/feeds/google-merchant.xml/route'

describe('Merchant feed never publishes an empty (delisting) feed', () => {
  it('no rows → 503, not a valid empty 200', async () => {
    state.products = []; state.error = null
    expect((await GET()).status).toBe(503)
  })
  it('query error → 503', async () => {
    state.products = null; state.error = { message: 'boom' }
    expect((await GET()).status).toBe(503)
  })
  it('real products → 200 xml', async () => {
    state.products = [{ id: 1, slug: 'honey', name: 'Honey', short_description: 's', description: 'd', image_url: 'https://x/y.jpg', weight_grams: 250, categories: { name: 'Honey' } }]
    state.error = null
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toMatch(/xml/)
  })
})
