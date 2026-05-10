// ─────────────────────────────────────────────────────────────
// orderService — orders API calls
//
// Features:
//  ✅ Server-side pagination (?page=&limit=)
//  ✅ Server-side search (?search=&status=)
//  ✅ Retry with exponential backoff
//  ✅ Zod schema validation
//  ✅ Independent of React — testable
// ─────────────────────────────────────────────────────────────
import { z } from 'zod'
import { ServiceError } from './profileService'

// ── Zod Schema ───────────────────────────────────────────────
const OrderItemSchema = z.object({
  qty:       z.number(),
  price:     z.number(),
  name:      z.string(),
  emoji:     z.string(),
  image_url: z.string().nullable(),
  variant:   z.string().nullable().optional(),
})

export const OrderSchema = z.object({
  id:              z.union([z.string(), z.number()]),
  order_number:    z.string(),
  order_status:    z.string(),
  _displayStatus:  z.string(),
  payment_method:  z.string().nullable(),
  payment_status:  z.string().nullable(),
  total_amount:    z.number(),
  created_at:      z.string(),
  tracking_number: z.string().nullable(),
  courier:         z.string().nullable(),
  shipped_at:      z.string().nullable(),
  delivered_at:    z.string().nullable(),
  updated_at:      z.string().nullable().optional(),
  items:           z.array(OrderItemSchema),
  _return:         z.unknown().nullable(),
})

const OrdersResponseSchema = z.object({
  success: z.boolean(),
  orders:  z.array(OrderSchema),
  total:   z.number().optional(),
  page:    z.number().optional(),
  pages:   z.number().optional(),
  stats:   z.object({
    delivered: z.number(),
    active:    z.number(),
    cancelled: z.number(),
    spent:     z.number(),
  }).optional(),
})

export type Order          = z.infer<typeof OrderSchema>
export type OrdersResponse = z.infer<typeof OrdersResponseSchema>

export interface FetchOrdersParams {
  page?:   number
  limit?:  number
  search?: string
  status?: string
  signal?: AbortSignal
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 800): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < retries; i++) {
    try { return await fn() } catch (err: unknown) {
      lastErr = err
      if (err instanceof ServiceError && err.status && err.status < 500) throw err
      if (i < retries - 1) await new Promise(r => setTimeout(r, delayMs * 2 ** i))
    }
  }
  throw lastErr
}

export async function fetchOrders(params: FetchOrdersParams = {}): Promise<OrdersResponse> {
  const { page = 1, limit = 20, search = '', status = '', signal } = params
  const qs = new URLSearchParams({
    page: String(page), limit: String(limit),
    ...(search ? { search } : {}),
    ...(status && status !== 'all' ? { status } : {}),
  })
  const timeoutCtrl    = new AbortController()
  const timeoutId      = setTimeout(() => timeoutCtrl.abort(new Error('Timeout')), 15000)
  const onCallerAbort  = () => timeoutCtrl.abort(signal?.reason)
  signal?.addEventListener('abort', onCallerAbort)

  try {
    const raw = await withRetry(async () => {
      const res  = await fetch(`/api/orders?${qs}`, { signal: timeoutCtrl.signal })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new ServiceError(
        (data as { error?: string }).error || `Orders fetch failed (${res.status})`, res.status
      )
      return data
    })

    const parsed = OrdersResponseSchema.safeParse(raw)
    if (!parsed.success) {
      console.error('[orderService] Invalid /api/orders response:', parsed.error.flatten())
      return { success: true, orders: [], total: 0, page: 1, pages: 0 }
    }
    return parsed.data
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onCallerAbort)
  }
}
