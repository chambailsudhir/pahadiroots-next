import { NextRequest, NextResponse, after } from 'next/server'
import { subscribeSchema, reviewSchema, notifyStockSchema, saveAbandonedCartSchema, markCartConvertedSchema } from '@/lib/schemas'
import { getServiceClient } from '@/lib/supabase'
import { checkCsrf, getToken } from '@/lib/api/serverUtils'
import { checkRateLimitKv } from '@/lib/api/rateLimitKv'
import { esc } from '@/lib/server/htmlEscape'
import { sendTransactionalEmail } from '@/lib/server/email'
import { sendSubscribeConfirmation } from '@/lib/server/subscribe'
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
  // BUG FIX (audit C-11): this used the in-process `checkRateLimit` (a Map per serverless instance), so the real limit
  // was 10/min PER INSTANCE and a spread-out flood was never counted. The shared limiter (Upstash KV, DB fallback)
  // counts across all instances like the orders/coupons routes do.
  if (!(await checkRateLimitKv(`mw:rl:actions_ip:${ip}`, 10, 60))) {
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

      const { email, name, source } = parsed.data

      // BUG FIX: name was inserted raw into the subscribers table with no HTML
      // stripping. A bot could store "<script>alert(1)</script>" as a subscriber
      // name which would be rendered as HTML in any admin email export.
      const safeName = name ? stripTags(name) : null

      // DOUBLE OPT-IN (audit C-11). This public endpoint used to subscribe whatever address it was handed and email
      // that address a coupon — anyone could subscribe a stranger, or use it to spam an inbox. Now it ONLY emails a
      // signed confirmation link (lib/server/subscribe.ts); the address is stored and the 5%-off code is sent when its
      // owner opens that link (api/v1/subscribe/confirm). Nothing is written to the database here.
      //
      // At most 3 confirmation emails per address per hour (shared limiter, so it holds across serverless instances).
      // The response is identical either way, so the endpoint cannot be used to find out which addresses are known.
      const mayEmail = await checkRateLimitKv(`mw:rl:subscribe_email:${email}`, 3, 3600)
      if (mayEmail) {
        after(async () => {
          try {
            await sendSubscribeConfirmation({ email, name: safeName, source: source || null })
          } catch (e) {
            logger.error('actions: subscribe confirmation email failed', { action: 'actions.subscribe.confirm', error: e instanceof Error ? e.message : String(e) })
          }
        })
      }
      return NextResponse.json({ success: true, pending: true })
    }

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

    // ── Abandoned-cart capture ────────────────────────────────────────────
    // Fired (debounced) from CheckoutClient once the customer has entered
    // enough contact info to be reachable. Upserts on session_id — see
    // db migration add_session_id_to_abandoned_carts. Never blocks
    // checkout: any failure here is logged and swallowed, same pattern as
    // the in-house analytics tracker.
    if (action === 'save_abandoned_cart') {
      const parsed = saveAbandonedCartSchema.safeParse(body)
      if (!parsed.success) return NextResponse.json({ error: 'Invalid abandoned cart payload' }, { status: 400 })
      const { session_id, email, phone, name, items, cart_total } = parsed.data
      const safeName = name ? stripTags(name) : null

      const { error } = await db.from('abandoned_carts').upsert(
        {
          session_id,
          email:      email || null,
          phone:      phone || null,
          name:       safeName,
          cart_items: items,
          cart_total,
          converted:  false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'session_id' },
      )
      if (error) {
        logger.error('actions: abandoned_carts upsert failed', { action: 'actions.save_abandoned_cart', error: error.message })
        return NextResponse.json({ error: 'Could not save cart' }, { status: 500 })
      }
      return NextResponse.json({ success: true })
    }

    // Fired from order-success once we know an order genuinely went
    // through — marks this session's draft cart as converted so it's
    // excluded from reminder sends. No-op (not an error) if no row
    // exists for this session (e.g. no email/phone was ever captured).
    if (action === 'mark_cart_converted') {
      const parsed = markCartConvertedSchema.safeParse(body)
      if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
      const { error } = await db.from('abandoned_carts')
        .update({ converted: true, updated_at: new Date().toISOString() })
        .eq('session_id', parsed.data.session_id)
      if (error) {
        logger.error('actions: mark_cart_converted failed', { action: 'actions.mark_cart_converted', error: error.message })
        // Non-fatal — the order itself already succeeded by the time this fires.
      }
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
