import { describe, it, expect, vi, beforeEach } from 'vitest'

const revalidatePath = vi.fn()
const revalidateTag = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: (...a: any[]) => revalidatePath(...a), revalidateTag: (...a: any[]) => revalidateTag(...a) }))

let rows: any = { data: [], error: null }
const inFn = vi.fn(async () => rows)
vi.mock('@/lib/supabase', () => ({ getServiceClient: () => ({ from: () => ({ select: () => ({ in: inFn }) }) }) }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), metric: vi.fn() }, captureError: vi.fn() }))

import { refreshCatalogIfSoldOut, refreshCatalogPages } from '@/lib/server/catalogFreshness'

beforeEach(() => { revalidatePath.mockReset(); revalidateTag.mockReset(); inFn.mockClear(); rows = { data: [], error: null } })

describe('catalogFreshness', () => {
  it('refreshCatalogPages expires the catalog tag, the homepage and the listing', () => {
    refreshCatalogPages()
    expect(revalidateTag).toHaveBeenCalledWith('store-data', { expire: 0 })
    expect(revalidatePath).toHaveBeenCalledWith('/', 'page')
    expect(revalidatePath).toHaveBeenCalledWith('/products', 'page')
  })
  it('refreshes when an ordered variant hit zero', async () => {
    rows = { data: [{ id: 1, available_stock: 5 }, { id: 2, available_stock: 0 }], error: null }
    expect(await refreshCatalogIfSoldOut(['1', '2'])).toBe(true)
    expect(revalidatePath).toHaveBeenCalledWith('/', 'page')
  })
  it('does NOT regenerate the page while stock remains (protects CPU)', async () => {
    rows = { data: [{ id: 1, available_stock: 3 }], error: null }
    expect(await refreshCatalogIfSoldOut(['1'])).toBe(false)
    expect(revalidatePath).not.toHaveBeenCalled()
  })
  it('never throws and never refreshes on a DB error or empty input', async () => {
    rows = { data: null, error: { message: 'boom' } }
    expect(await refreshCatalogIfSoldOut(['1'])).toBe(false)
    expect(await refreshCatalogIfSoldOut([])).toBe(false)
    expect(inFn).toHaveBeenCalledTimes(1)
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
