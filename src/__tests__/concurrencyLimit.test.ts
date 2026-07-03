/**
 * concurrencyLimit.test.ts
 *
 * Real regression coverage for the CRITICAL fix: during `next build`,
 * Next.js renders every product page in parallel via generateStaticParams.
 * Each page's fetchProductData() call fires its own independent Supabase
 * request burst; unbounded, N products building concurrently means N × ~6
 * simultaneous requests — enough to exhaust Supabase's connection pool and
 * cascade into timeouts on unrelated routes (this is exactly what showed up
 * in production Vercel logs: getSiteSettings, /api/orders, /api/loyalty,
 * /api/cart-upsells all failing at once during a deploy).
 *
 * These tests prove the Semaphore actually bounds concurrency — not just
 * that it exists / type-checks.
 */

import { describe, it, expect, vi } from 'vitest'
import { Semaphore } from '@/lib/concurrencyLimit'

describe('Semaphore', () => {
  it('never lets more than `max` callbacks run concurrently', async () => {
    const sem = new Semaphore(3)
    let active = 0
    let maxObservedActive = 0

    const task = () => sem.run(async () => {
      active++
      maxObservedActive = Math.max(maxObservedActive, active)
      await new Promise(r => setTimeout(r, 10))
      active--
      return 'done'
    })

    // Fire 20 "pages" at once — simulates Next.js trying to build 20 product
    // pages in parallel.
    const results = await Promise.all(Array.from({ length: 20 }, task))

    expect(maxObservedActive).toBeLessThanOrEqual(3)
    expect(results).toHaveLength(20)
    expect(results.every(r => r === 'done')).toBe(true)
  })

  it('queued callers still all eventually run (no starvation/deadlock)', async () => {
    const sem = new Semaphore(2)
    const order: number[] = []
    const task = (n: number) => sem.run(async () => {
      await new Promise(r => setTimeout(r, 5))
      order.push(n)
    })

    await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(task))
    expect(order.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('releases the slot even when the wrapped function throws (no permanent slot leak)', async () => {
    const sem = new Semaphore(1)

    await expect(sem.run(async () => { throw new Error('boom') })).rejects.toThrow('boom')

    // If the failed run had leaked its slot, this would hang forever.
    const fn = vi.fn(async () => 'ok')
    const result = await Promise.race([
      sem.run(fn),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DEADLOCK: slot never released')), 500)),
    ])
    expect(result).toBe('ok')
  })

  it('runs all tasks immediately (no queueing) when under the concurrency cap', async () => {
    const sem = new Semaphore(10)
    const start = Date.now()
    await Promise.all(Array.from({ length: 5 }, () => sem.run(async () => {
      await new Promise(r => setTimeout(r, 20))
    })))
    // If they were serialized instead of concurrent, this would take ~100ms+.
    expect(Date.now() - start).toBeLessThan(80)
  })
})
