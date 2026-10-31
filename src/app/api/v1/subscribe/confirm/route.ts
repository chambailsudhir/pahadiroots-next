import { NextRequest, NextResponse, after } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { checkRateLimitKv } from '@/lib/api/rateLimitKv'
import { verifySubscribeToken } from '@/lib/server/subscribeToken'
import { activateSubscriber, sendWelcomeCoupon } from '@/lib/server/subscribe'
import { logger } from '@/lib/logger'

// Step 2 of the newsletter double opt-in: the link in the confirmation email lands here.
// GET (a plain link click) — the token is the proof that the owner of the address asked to subscribe.

const SITE = () => (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pahadiroots.com').replace(/\/+$/, '')

function page(status: number, title: string, message: string) {
  const html = `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${title} — HimVeda by Pahadi Roots</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0d2410;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#fff;padding:24px}
main{max-width:460px;text-align:center}h1{font-family:Georgia,serif;font-size:28px;margin:0 0 12px}p{line-height:1.6;color:rgba(255,255,255,.85);margin:0 0 24px}
a{display:inline-block;background:#e0b64a;color:#0d2410;font-weight:800;text-decoration:none;padding:13px 26px;border-radius:12px}</style></head>
<body><main><h1>${title}</h1><p>${message}</p><a href="${SITE()}/">Back to the store</a></main></body></html>`
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })
}

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!(await checkRateLimitKv(`mw:rl:subscribe_confirm_ip:${ip}`, 30, 60))) {
    return page(429, 'Please wait a moment', 'Too many attempts. Please try the link again in a minute.')
  }

  let verified
  try {
    verified = verifySubscribeToken(req.nextUrl.searchParams.get('t') ?? '')
  } catch (e) {
    logger.error('subscribe/confirm: token verification unavailable', { action: 'subscribe.confirm', error: e instanceof Error ? e.message : String(e) })
    return page(503, 'Something went wrong', 'We could not confirm your email right now. Please try the link again shortly.')
  }
  if (!verified.ok) {
    return page(400, 'Link not valid', 'This confirmation link is invalid or has expired. Please sign up again to get a fresh link.')
  }

  const { email, name, source } = verified.payload
  const db = getServiceClient()
  const error = await activateSubscriber(db, { email, name, source })
  if (error) {
    logger.error('subscribe/confirm: subscribers upsert failed', { action: 'subscribe.confirm', error: error.message })
    return page(500, 'Something went wrong', 'We could not save your subscription. Please try the link again shortly.')
  }

  // Opening the link twice must not mail the code twice: at most 2 welcome emails per address per day.
  if (await checkRateLimitKv(`mw:rl:subscribe_welcome:${email}`, 2, 86400)) {
    after(() => sendWelcomeCoupon(db, { email, name }))
  }
  return page(200, 'You’re in!', 'Thank you for confirming. Your 5% first-order code is on its way to your inbox — it can take a minute to arrive.')
}
