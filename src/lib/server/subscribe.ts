import { createSubscribeToken } from './subscribeToken'
import { sendTransactionalEmail } from './email'
import { generateWelcomeCouponCode } from '@/lib/welcomeCoupon'
import { esc } from './htmlEscape'
import { logger } from '@/lib/logger'
import type { getServiceClient } from '@/lib/supabase'

type Db = ReturnType<typeof getServiceClient>

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pahadiroots.com').replace(/\/+$/, '')
const FROM = 'HimVeda by Pahadi Roots <noreply@pahadiroots.com>'

/** Step 1 of double opt-in: email a link. Nothing is stored and no coupon is created until the link is opened. */
export async function sendSubscribeConfirmation(p: { email: string; name: string | null; source: string | null }) {
  const link = `${siteUrl()}/api/v1/subscribe/confirm?t=${createSubscribeToken(p)}`
  return sendTransactionalEmail({
    type: 'newsletter_confirm', to: p.email, from: FROM,
    subject: 'Please confirm your email — HimVeda by Pahadi Roots',
    html: `<p>Hi${p.name ? ' ' + esc(p.name) : ''},</p>
<p>Thanks for your interest in HimVeda by Pahadi Roots. Please confirm your email address to join the community and receive your 5% first-order code:</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#1a3a1e;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;">Confirm my email</a></p>
<p>This link works for 48 hours. If you did not ask for this, you can ignore this email and nothing will happen.</p>`,
    context: { confirm_for: esc(p.email) },
  })
}

/** Step 2 (after the link is opened): store the subscriber. Returns the DB error, if any. */
export async function activateSubscriber(db: Db, p: { email: string; name: string | null; source: string | null }) {
  const { error } = await db.from('subscribers').upsert(
    // Real columns only (there is no `subscribed_at`; created_at defaults in the database).
    { email: p.email, name: p.name, is_active: true, source: p.source },
    { onConflict: 'email' },
  )
  return error
}

/** Creates the single-use 5%-off first-order coupon (idempotent per email) and emails it. Best-effort. */
export async function sendWelcomeCoupon(db: Db, p: { email: string; name: string | null }) {
  try {
    const code = generateWelcomeCouponCode(p.email)
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    await db.from('coupons').upsert(
      {
        code, type: 'percent', value: 5, max_uses: 1, uses_count: 0, is_active: true,
        expires_at: expiresAt, first_order_only: true,
        description: 'Newsletter welcome discount (5% off, first order)',
      },
      { onConflict: 'code', ignoreDuplicates: true },
    )
    await sendTransactionalEmail({
      type: 'newsletter_welcome', to: p.email, from: FROM,
      subject: 'Welcome to HimVeda by Pahadi Roots — here’s 5% off your first order',
      html: `<p>Hi${p.name ? ' ' + esc(p.name) : ''},</p>
<p>Thanks for joining the HimVeda by Pahadi Roots community! Use the code below at checkout for 5% off your first order:</p>
<p style="font-size:20px;font-weight:800;letter-spacing:1px;">${esc(code)}</p>
<p>Valid for 30 days, one-time use.</p>`,
      context: { subscribed_email: esc(p.email), coupon_code: code },
    })
  } catch (e) {
    logger.error('subscribe: welcome coupon/email failed', { action: 'subscribe.welcome', error: e instanceof Error ? e.message : String(e) })
  }
}
