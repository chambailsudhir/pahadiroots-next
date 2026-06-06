import { NextRequest, NextResponse } from 'next/server'
import { subscribeSchema, reviewSchema } from '@/lib/schemas'
import { getServiceClient } from '@/lib/supabase'
import { checkCsrf, getToken } from '@/lib/api/serverUtils'
import { esc } from '@/lib/server/htmlEscape'
import { Resend } from 'resend'

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

  try {
    const body   = await req.json()
    const action = body.action as string
    const db     = getServiceClient()

    if (action === 'subscribe') {
      const parsed = subscribeSchema.safeParse(body)
      if (!parsed.success) return NextResponse.json({ error: 'Invalid email' }, { status: 400 })

      const { email, name } = parsed.data

      // Upsert to subscribers table
      await db.from('subscribers').upsert(
        { email, name: name || null, subscribed_at: new Date().toISOString() },
        { onConflict: 'email' }
      )
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
      try {
        // HTML-escape before interpolating into email HTML to prevent injection
        const safeName    = esc(String(body.name    ?? ''))
        const safeEmail   = esc(String(body.email   ?? ''))
        const safeMessage = esc(String(body.message ?? ''))
        const resend = new Resend(process.env.RESEND_API_KEY)
        await resend.emails.send({
          from:    'Pahadi Roots Contact <noreply@pahadiroots.com>',
          to:      [process.env.ADMIN_EMAIL || 'hello@pahadiroots.com'],
          subject: `Contact form: ${safeName}`,
          html:    `<p><b>Name:</b> ${safeName}<br><b>Email:</b> ${safeEmail}<br><b>Message:</b> ${safeMessage}</p>`,
        })
      } catch { /* non-fatal */ }
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  } catch (err: unknown) {
    const internalMessage = err instanceof Error ? err.message : 'Server error'
    console.error('[cart API]', internalMessage)
    const clientMessage = process.env.NODE_ENV === 'production'
      ? 'Something went wrong. Please try again.'
      : internalMessage
    return NextResponse.json({ error: clientMessage }, { status: 500 })
  }
}
