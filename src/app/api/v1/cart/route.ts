import { NextRequest, NextResponse } from 'next/server'
import { subscribeSchema, reviewSchema } from '@/lib/schemas'
import { getServiceClient } from '@/lib/supabase'
import { checkCsrf, getToken } from '@/lib/api/serverUtils'
import DOMPurify from 'isomorphic-dompurify'
import { Resend } from 'resend'

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

      // Sanitize text (Audit #G26)
      const comment = d.comment ? DOMPurify.sanitize(d.comment.trim()) : null
      const name    = DOMPurify.sanitize(d.customer_name.trim())

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
        // Sanitize all user-supplied fields before HTML interpolation (XSS prevention)
        const safeName    = DOMPurify.sanitize(String(body.name    ?? ''))
        const safeEmail   = DOMPurify.sanitize(String(body.email   ?? ''))
        const safeMessage = DOMPurify.sanitize(String(body.message ?? ''))
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
