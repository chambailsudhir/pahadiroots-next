/**
 * /api/v1/cart — DEPRECATED path, kept for backwards compatibility only.
 *
 * All action handlers (subscribe, submit_review, contact) have moved to
 * /api/v1/actions. This file issues a 308 Permanent Redirect so any
 * cached or third-party call still works, while guiding callers to update.
 *
 * Frontend callers updated: Footer.tsx, contact/page.tsx (NewsletterBar.tsx
 * also called this before it was deleted as a confirmed duplicate of
 * Footer.tsx's own newsletter form)
 */
import { NextRequest, NextResponse } from 'next/server'

export function POST(req: NextRequest) {
  const url = new URL(req.url)
  url.pathname = url.pathname.replace('/api/v1/cart', '/api/v1/actions')
  return NextResponse.redirect(url, { status: 308 })
}
