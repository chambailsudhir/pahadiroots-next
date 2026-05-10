import { captureError } from '@/lib/logger'
// ─────────────────────────────────────────────────────────────
// profileService — all profile API calls in one place
//
// Features:
//  ✅ Retry with exponential backoff (3 attempts)
//  ✅ Per-request timeout (AbortSignal.timeout)
//  ✅ Zod schema validation on all responses
//  ✅ Centralized error handling
//  ✅ Completely independent of React — easy to unit test
// ─────────────────────────────────────────────────────────────
import { z } from 'zod'

// ── Zod Schemas — API response validation ────────────────────
export const ProfileSchema = z.object({
  id:              z.union([z.string(), z.number()]).optional(),
  first_name:      z.string().optional(),
  last_name:       z.string().optional(),
  phone:           z.string().optional(),
  email:           z.string().optional(),
  address_line1:   z.string().optional(),
  city:            z.string().optional(),
  state:           z.string().optional(),
  postal_code:     z.string().optional(),
  saved_addresses: z.string().optional(),
}).catchall(z.unknown())

export const ProfileResponseSchema = z.object({
  profile: ProfileSchema.optional(),
  user:    z.object({
    id:    z.union([z.string(), z.number()]).optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
  }).catchall(z.unknown()).optional(),
})

export type Profile     = z.infer<typeof ProfileSchema>
export type ProfileResp = z.infer<typeof ProfileResponseSchema>

// ── Retry helper ─────────────────────────────────────────────
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 800,
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err: unknown) {
      lastErr = err
      // Don't retry on 4xx (client errors) — only on network / 5xx
      if (err instanceof ServiceError && err.status && err.status < 500) throw err
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, delayMs * 2 ** i)) // 800ms, 1.6s, 3.2s
      }
    }
  }
  throw lastErr
}

// ── Custom error ─────────────────────────────────────────────
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) { super(message) }
}

// ── Base fetch ───────────────────────────────────────────────
async function apiFetch(
  url: string,
  options: RequestInit = {},
  timeoutMs = 10000,
): Promise<unknown> {
  // Compose: options.signal (caller) + timeout — both can abort
  const timeoutCtrl   = new AbortController()
  const timeoutId     = setTimeout(() => timeoutCtrl.abort(new Error('Timeout')), timeoutMs)
  const callerSignal  = options.signal as AbortSignal | undefined
  const onCallerAbort = () => timeoutCtrl.abort(callerSignal?.reason)
  callerSignal?.addEventListener('abort', onCallerAbort)

  try {
    const res = await fetch(url, {
      ...options,
      signal: timeoutCtrl.signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = (data as { error?: string }).error || `Request failed (${res.status})`
      throw new ServiceError(msg, res.status)
    }
    return data
  } finally {
    clearTimeout(timeoutId)
    callerSignal?.removeEventListener('abort', onCallerAbort)
  }
}

// ── Public API ───────────────────────────────────────────────

/** Fetch profile + user. Retries on network failure. Validates response. */
export async function fetchProfile(): Promise<ProfileResp> {
  const raw = await withRetry(() => apiFetch('/api/profile'))
  const parsed = ProfileResponseSchema.safeParse(raw)
  if (!parsed.success) {
    captureError(parsed.error, { action: 'profileService/fetchProfile', validation: true })
    throw new ServiceError('Unexpected response from server')
  }
  return parsed.data
}

/** Update profile fields. Retries on network failure. */
export async function updateProfile(updates: Partial<Profile>): Promise<void> {
  await withRetry(() =>
    apiFetch('/api/profile', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(updates),
    })
  )
}

/** Change password. No retry (user action). */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await apiFetch('/api/auth', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      action:           'change_password',
      current_password: currentPassword,
      new_password:     newPassword,
    }),
  })
}

/** Check session. No retry. */
export async function checkSession(): Promise<{ loggedIn: boolean }> {
  const raw = await apiFetch('/api/auth/session', {}, 8000)
  const parsed = z.object({ loggedIn: z.boolean() }).safeParse(raw)
  if (!parsed.success) return { loggedIn: false }
  return parsed.data
}
