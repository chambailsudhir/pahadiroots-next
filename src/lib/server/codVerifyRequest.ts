// Shared input handling for /api/v1/cod-verify/{start,confirm} (Nov 2026). Server-only.
import 'server-only'
import { z } from 'zod'

export const MOBILE_RE = /^[6-9]\d{9}$/
export function phone10(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '').replace(/^(91|0)(?=[6-9]\d{9}$)/, '')
  return MOBILE_RE.test(d) ? d : null
}
export const startSchema = z.object({
  phone: z.string().min(10).max(16),
  email: z.string().trim().email().max(254),
})
export const confirmSchema = startSchema.extend({
  code: z.string().trim().regex(/^\d{6}$/),
})
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  if (!domain) return email
  const shown = user.length <= 2 ? user[0] ?? '' : user.slice(0, 2)
  return `${shown}${'*'.repeat(Math.max(1, user.length - shown.length))}@${domain}`
}
