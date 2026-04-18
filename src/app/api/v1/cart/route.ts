import { NextResponse } from 'next/server'
import { subscribeSchema, reviewSchema } from '@/lib/schemas'
import { getServiceClient } from '@/lib/supabase'
import DOMPurify from 'isomorphic-dompurify'

export async function POST(req: Request) {
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



    if (action === 'save_addresses') {
      const { phone, saved_addresses } = body
      if (!phone || !Array.isArray(saved_addresses)) {
        return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
      }
      await db.from('customers')
        .update({ saved_addresses, updated_at: new Date().toISOString() })
        .eq('phone', phone)
      return NextResponse.json({ success: true })
    }

    if (action === 'contact') {
      // Log contact form to admin_logs or send email
      try {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        await resend.emails.send({
          from:    'Pahadi Roots Contact <noreply@pahadiroots.com>',
          to:      [process.env.ADMIN_EMAIL || 'hello@pahadiroots.com'],
          subject: `Contact form: ${body.name}`,
          html:    `<p><b>Name:</b> ${body.name}<br><b>Email:</b> ${body.email}<br><b>Message:</b> ${body.message}</p>`,
        })
      } catch { /* non-fatal */ }
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  } catch (err: any) {
    console.error('[cart API]', err)
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}
