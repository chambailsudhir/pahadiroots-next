// ─────────────────────────────────────────────────────────────────────────────
// lib/server/cronAuth.ts — Bearer ${CRON_SECRET} check for cron routes.
// Fails CLOSED (500 + alert) when CRON_SECRET is unset; constant-time compare.
// Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically for paths
// listed in vercel.json `crons`; an external scheduler can send the same header.
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from 'next/server'
import { captureError } from '@/lib/logger'
import { safeEqual } from '@/lib/server/razorpay'

/** Returns a NextResponse to send back when the request is NOT allowed, else null. */
export function rejectUnlessCron(req: Request, action: string): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    captureError(new Error('CRON_SECRET not configured — ' + action + ' is broken'), { action: `${action}.no_secret`, alert: true })
    return NextResponse.json({ error: 'Cron not configured' }, { status: 500 })
  }
  const received = req.headers.get('authorization') ?? ''
  if (!safeEqual(received, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
