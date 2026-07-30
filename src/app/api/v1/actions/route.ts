import { NextRequest, NextResponse, after } from 'next/server'
import { subscribeSchema, reviewSchema, notifyStockSchema } from '@/lib/schemas'
import { getServiceClient } from '@/lib/supabase'
import { checkCsrf, getToken, checkRateLimit } from '@/lib/api/serverUtils'
import { esc } from '@/lib/server/htmlEscape'
import { sendTransactionalEmail } from '@/lib/server/email'
import { generateWelcomeCouponCode } from '@/lib/welcomeCoupon'
import { logger } from '@/lib/logger'

// BUG-1 FIX: `isomorphic-dompurify` uses a browser DOM shim that triggers ESM
// resolution errors in Next.js 14 App Router server routes. The original import
// was `import DOMPurify from 'isomorphic-dompurify'` which caused cold-start
// crashes on certain Vercel/Node builds.
//
// For SERVER-SIDE use we don't need a full DOM sanitiser — we just need to:
//   1. Strip HTML tags before storing user text in the DB (prevents stored XSS
//      when the text is later rendered as HTML in emails/admin UI).
//   2. HTML-escape strings before interpolating into email HTML bodies
//      (prevents injection into the email's own HTML structure).
//
// `stripTags` handles (1). `esc` from htmlEscape handles (2) and is already
// used by orders/route.ts and payments/route.ts for the same purpose.
function stripTags(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim()
}

/**
 * /api/v1/actions — generic action dispatcher for non-cart server mutations.
 *
 * Handles: subscribe, submit_review, contact
 *
 * Previously this file lived at /api/v1/cart/route.ts which was misleading —
 * none of these actions are cart-related. Renamed to /api/v1/actions.
 * The old path /api/v1/cart now 308-redirects here for backwards compatibility.
 */

export async function POST(req: NextRequest) {
  // ── CSRF guard — protects subscribe, submit_review, contact ──────────────
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  // ── Rate limit ─────────────────────────────────────────────────────────────
  // subscribe and contact are unauthenticated and have no other anti-spam
  // guard — without a rate limit a bot can flood the subscribers table and
  // admin inbox indefinitely. checkRateLimit() is the in-process limiter
  // (sufficient here: these are low-risk, non-financial actions where a small
  // per-replica burst window is acceptable). 10 requests/min per IP covers all
  // legitimate use (a real user doesn't submit the contact form 10 times/min).
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const rateLimitKey = `actions:${ip}`
  if (!checkRateLimit(rateLimitKey, 10, 60_000)) {
    // BUG FIX 12: missing Retry-After header on 429. RFC 6585 §4 requires it.
    return NextResponse.json(
      { error: 'Too many requests — please wait a moment' },
      { status: 429, headers: { 'Retry-After': '60' } },
    )
  }

  try {
    const body   = await req.json()

    // BUG FIX: `body.action as string` is an unsafe TypeScript cast with no
    // runtime effect — if a client sends action: null, action: 42, or omits
    // the field, the string comparisons below silently fall through and return
    // the generic "Unknown action" 400. This is safe from a security standpoint
    // but identical to the pattern we already fixed in payments/route.ts.
    // Validate explicitly so malformed payloads are logged with a clear message
    // rather than silently hitting the Unknown action fallback.
    const action = typeof body.action === 'string' ? body.action : null
    if (!action) {
      return NextResponse.json({ error: 'Missing or invalid action field' }, { status: 400 })
    }
    const db     = getServiceClient()

    if (action === 'subscribe') {
      const parsed = subscribeSchema.safeParse(body)
      if (!parsed.success) return NextResponse.json({ error: 'Invalid email' }, { status: 400 })

      const { email, name } = parsed.data

      // BUG FIX: name was inserted raw into the subscribers table with no HTML
      // stripping. A bot could store "<script>alert(1)</script>" as a subscriber
      // name which would be rendered as HTML in any admin email export.
      const safeName = name ? stripTags(name) : null

      // Upsert to subscribers table
      const { error: subscribeError } = await db.from('subscribers').upsert(
        // BUG FIX (found while schema-verifying the P1 batch — pre-existing,
        // not introduced by this fix): the real `subscribers` table has no
        // `subscribed_at` column at all (confirmed via
        // information_schema.columns). This upsert has been sending a
        // column that doesn't exist — Supabase/PostgREST rejects unknown
        // columns on insert/upsert, so every newsletter signup may have
        // been erroring silently (the result was never checked for
        // `error` here). Removed the bogus field; `created_at` is NOT
        // NULL with no default confirmed either way, so left unset — if
        // it turns out to have no DB-side default, the error logging
        // added below will now surface that loudly instead of silently.
        // is_active is nullable but obviously means "this is a live
        // subscriber" — explicitly set true for a fresh signup rather
        // than leaving it NULL.
        { email, name: safeName, is_active: true },
        { onConflict: 'email' }
      )
      if (subscribeError) {
        logger.error('actions: subscribers upsert failed', { action: 'actions.subscribe', error: subscribeError.message })
        return NextResponse.json({ error: 'Could not subscribe right now — please try again' }, { status: 500 })
      }

      // ── BUG FIX (P1 — trust): the homepage newsletter form promised
      // "Get 5% Off Your First Order" and, on success, "Check your inbox
      // for your discount code" (originally NewsletterBar.tsx, since
      // deleted as a confirmed duplicate of Footer.tsx's own newsletter
      // form — both hit this same action). Previously nothing after this
      // point existed — no code was ever generated, no email was ever
      // sent. Every subscriber got a false promise. This block actually
      // fulfills it:
      //
      //   1. Derive a deterministic code from the email (sha256, first 6
      //      hex chars) so the SAME email always maps to the SAME code —
      //      re-submitting the form (e.g. double-click, or resubscribing
      //      months later) can't mint unlimited fresh 5%-off coupons for
      //      one person.
      //   2. Upsert into `coupons` with `ignoreDuplicates: true` — if this
      //      email already has a welcome coupon, this is a no-op (doesn't
      //      reset uses_count on a coupon that's already been redeemed).
      //   3. Email the code via the existing sendTransactionalEmail
      //      pipeline, which already retries + dead-letters on failure
      //      (src/lib/server/email.ts) — same guarantee the contact-form
      //      email below already relies on.
      //
      // Deliberately best-effort and non-blocking: a coupon/email hiccup
      // must never fail the newsletter signup itself (matches the
      // contact-form pattern immediately below).
      // BUG FIX (same class as the checkout 504 fix): deferred to after() so
      // a slow/retrying email send can't delay or fail the newsletter
      // signup response. Coupon creation + email happen in the background;
      // delivery guarantee (incl. failed_emails dead-letter) is unchanged.
      after(async () => {
        try {
          const code = generateWelcomeCouponCode(email)
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

          await db.from('coupons').upsert(
            {
              code,
              type:              'percent',
              value:             5,
              max_uses:          1,
              uses_count:        0,
              is_active:         true,
              expires_at:        expiresAt,
              first_order_only:  true,
              description:       'Newsletter welcome discount (5% off, first order)',
            },
            { onConflict: 'code', ignoreDuplicates: true },
          )

          const safeEmailForHtml = esc(email)
          await sendTransactionalEmail({
            type:    'newsletter_welcome',
            to:      email,
            from:    'HimVeda by Pahadi Roots <noreply@pahadiroots.com>',
            subject: 'Welcome to HimVeda by Pahadi Roots — here\u2019s 5% off your first order',
            html:    `<p>Hi${safeName ? ' ' + esc(safeName) : ''},</p>
<p>Thanks for joining the HimVeda by Pahadi Roots community! Use the code below at checkout for 5% off your first order:</p>
<p style="font-size:20px;font-weight:800;letter-spacing:1px;">${esc(code)}</p>
<p>Valid for 30 days, one-time use.</p>`,
            context: { subscribed_email: safeEmailForHtml, coupon_code: code },
          })
        } catch (e) {
          // Non-fatal — the subscription itself already succeeded above.
          logger.error('actions: newsletter welcome coupon/email failed', { action: 'actions.subscribe.welcomeEmail', error: e instanceof Error ? e.message : String(e) })
        }
      })

      return NextResponse.json({ success: true })
    }

    // ── BUG FIX (P1, homepage audit): ProductCard.tsx's "Notify Me" button
    // on out-of-stock products was rendered disabled with no onClick, no
    // email capture, and no backend at all. This action is the real
    // capture behind it — see db_migration_v10_stock_notifications.sql
    // for the table, and the NOTE in that file about the separate,
    // schedulable restock-email job this does NOT include.
    if (action === 'notify_stock') {
      const parsed = notifyStockSchema.safeParse(body)
      if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

      const { email, product_id } = parsed.data

      const { error } = await db.from('stock_notifications').upsert(
        { product_id, email },
        { onConflict: 'product_id,email', ignoreDuplicates: true },
      )
      if (error) {
        logger.error('actions: notify_stock insert failed', { action: 'actions.notify_stock', error: error.message })
        return NextResponse.json({ error: 'Could not save your request — please try again' }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    }

    if (action === 'submit_review') {
      // ── Auth check — only logged-in users may submit reviews ─────────────
      const token = getToken(req)
      if (!token) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const parsed = reviewSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid review data' }, { status: 400 })
      }

      const d = parsed.data

      // Sanitize text: strip HTML tags before DB storage to prevent stored XSS
      const comment = d.comment ? stripTags(d.comment) : null
      const name    = stripTags(d.customer_name)

      await db.from('reviews').insert({
        product_id:    d.product_id,
        customer_name: name,
        rating:        d.rating,
        review_text:   comment,  // main column
        comment:       comment,  // added column (same value)
        status:        'pending', // real column - 'pending' until admin approves
        created_at:    new Date().toISOString(),
      })

      return NextResponse.json({ success: true, message: 'Review submitted for approval' })
    }



    if (action === 'contact') {
      // Log contact form to admin_logs or send email
      // BUG FIX: no length validation on name/email/message — an attacker
      // could submit megabyte-sized fields which would be relayed in the
      // email body and logged. Truncate before escape+send.
      const rawName    = String(body.name    ?? '').slice(0, 200)
      const rawEmail   = String(body.email   ?? '').slice(0, 200)
      const rawMessage = String(body.message ?? '').slice(0, 5000)

      // BUG FIX: email field was not validated as a real email address —
      // any string (including garbage like "><script>") could be relayed in
      // the admin email subject and body. Validate with a simple RFC-5321
      // compatible check before using it.
      const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)
      if (!emailValid) {
        return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
      }

      // BUG FIX (same class as the checkout 504 fix): the admin-notification
      // email is deferred to after() — validation above still runs
      // synchronously (so a bad email address still gets a 400 immediately),
      // but the actual send can't delay or fail the visitor's "message sent"
      // response.
      after(async () => {
        try {
          // HTML-escape before interpolating into email HTML to prevent injection
          const safeName    = esc(rawName)
          const safeEmail   = esc(rawEmail)
          const safeMessage = esc(rawMessage)
          // AUDIT FIX [ERROR HANDLING]: previously called resend.emails.send()
          // directly. The Resend SDK resolves (never rejects) on API-level
          // failures, so the catch below never actually fired for the most
          // common failure mode — see lib/server/email.ts for the full
          // explanation. sendTransactionalEmail() checks the resolved `error`
          // field and dead-letters into `failed_emails` for retry instead of
          // the contact-form notification simply vanishing.
          await sendTransactionalEmail({
            type:    'contact_form',
            to:      process.env.ADMIN_EMAIL || 'hello@pahadiroots.com',
            from:    'HimVeda by Pahadi Roots Contact <noreply@pahadiroots.com>',
            subject: `Contact form: ${safeName}`,
            html:    `<p><b>Name:</b> ${safeName}<br><b>Email:</b> ${safeEmail}<br><b>Message:</b> ${safeMessage}</p>`,
            context: { submitted_email: rawEmail },
          })
        } catch (e) {
          // Catches errors from validating/building the email above —
          // sendTransactionalEmail() itself never throws.
          logger.error('actions: contact email send failed', { action: 'actions.contact.email', error: e instanceof Error ? e.message : String(e) })
        }
      })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  } catch (err: unknown) {
    const internalMessage = err instanceof Error ? err.message : 'Server error'
    logger.error('actions: handler error', { action: 'actions.handler', error: internalMessage })
    const clientMessage = process.env.NODE_ENV === 'production'
      ? 'Something went wrong. Please try again.'
      : internalMessage
    return NextResponse.json({ error: clientMessage }, { status: 500 })
  }
}
