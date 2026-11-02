'use client'

// ReferralCapture — invisible, mounted once in the root layout.
//  1. remembers `?ref=CODE` from a friend's link (30 days, this browser only);
//  2. as soon as the visitor is signed in, offers it to POST /api/v1/referral once and forgets it again.
// The server (database) decides whether the code counts; a code that can never work (not a new customer, own code…)
// is dropped, a network / server hiccup keeps it for the next page view.
import { useEffect, useRef } from 'react'
import { useUserStore } from '@/store/userStore'
import { captureReferralFromSearch, readPendingReferral, clearPendingReferral } from '@/lib/referral'

export default function ReferralCapture() {
  const signedIn = useUserStore(s => !!s.user)
  const sent = useRef(false)

  useEffect(() => {
    try { captureReferralFromSearch(window.location.search, window.localStorage) } catch { /* storage blocked */ }
  }, [])

  useEffect(() => {
    if (!signedIn || sent.current) return
    let code: string | null = null
    try { code = readPendingReferral(window.localStorage) } catch { return }
    if (!code) return
    sent.current = true
    fetch('/api/v1/referral', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
      .then(res => {
        // 200 = the server gave a final answer (applied or refused for good); 400 = malformed code. Keep it on 401/429/5xx.
        if (res.ok || res.status === 400) { try { clearPendingReferral(window.localStorage) } catch { /* ignore */ } }
        else sent.current = false
      })
      .catch(() => { sent.current = false })
  }, [signedIn])

  return null
}
