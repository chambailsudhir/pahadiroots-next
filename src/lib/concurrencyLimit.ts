// ─────────────────────────────────────────────────────────────────────────────
// lib/concurrencyLimit.ts
//
// BUG FIX (CRITICAL — regression found post-deploy via Vercel logs): during
// `next build` / a fresh deploy, Next.js statically pre-renders EVERY product
// page in parallel (generateStaticParams() returns every product slug). Before
// the getProductBySlug() refactor, every one of those pages shared ONE cached
// getStoreData() call (unstable_cache, 60s TTL) — so N products building
// concurrently cost roughly one query set, not N.
//
// getProductBySlug()/getRelatedProducts() replaced that with a targeted,
// UNCACHED per-product query (the right call for a single runtime request —
// see storeData.ts for why). But at build time, with N products rendering in
// parallel, each page's fetchProductData() now fires its own independent
// burst of Supabase requests (product + variants + images + related +
// reviews + state ≈ 5-6 requests). With no cap, N products × ~6 requests fire
// near-simultaneously against Supabase's PgBouncer pool — enough to exhaust
// it, which cascades into timeouts on completely unrelated routes
// (getSiteSettings, /api/orders, /api/loyalty, /api/cart-upsells) that share
// the same pool. That's exactly the pattern seen in production logs: dozens
// of routes failing with "operation timed out" at the same moment as a mass
// rebuild of /regions/* and /products/* pages.
//
// Fix: cap how many PDP data-fetch "units of work" run concurrently,
// regardless of how many pages Next.js tries to render in parallel. Excess
// requests queue instead of firing all at once.
// ─────────────────────────────────────────────────────────────────────────────

export class Semaphore {
  private active = 0
  private queue: Array<() => void> = []

  constructor(private readonly max: number) {}

  /** Runs `fn` once a slot is free; queues callers beyond `max` concurrent. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++
      return Promise.resolve()
    }
    return new Promise<void>(resolve => {
      this.queue.push(() => { this.active++; resolve() })
    })
  }

  private release() {
    this.active--
    const next = this.queue.shift()
    if (next) next()
  }
}

// Shared across all PDP page renders in this server process (one per Next.js
// worker/lambda). 5 is conservative headroom under Supabase's default pooled
// connection limits even on lower-tier plans, while still parallelizing
// enough to keep build times reasonable. Tune upward only after confirming
// the project's actual Supabase connection pool size.
export const pdpFetchLimiter = new Semaphore(5)
