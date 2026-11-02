'use client'
// ─────────────────────────────────────────────────────────────
// useProfile — form state + mutations only
//  ✅ Uses profileService (retry, timeout, zod)
//  ✅ Optimistic update + rollback on failure
//  ✅ Timer cleanup on unmount
//  ✅ Address CRUD delegated to shared useAddresses hook
// ─────────────────────────────────────────────────────────────

import { ga4AccountAction } from '@/lib/analytics/ga4'
import { useState, useRef, useEffect, useCallback } from 'react'
import { captureError } from '@/lib/logger'
import {
  validateProfileName, validateAddress, validatePhone,
  validatePassword, FormErrors,
} from '@/lib/account/validation'
import { getSavedAddresses, type SavedAddress } from '@/lib/account/utils'
import { updateProfile, changePassword as apiChangePassword, sendForgotPasswordEmail, ServiceError } from '@/lib/services/profileService'
import { clearProfileCache } from '@/lib/profileCache'
import { useAddresses } from './useAddresses'
import type { Profile } from './useAuth'

interface PfFields { fname: string; lname: string; addr: string; city: string; state: string; pin: string; phone: string }
const EMPTY_PF: PfFields = { fname: '', lname: '', addr: '', city: '', state: '', pin: '', phone: '' }

/** Map (part of) a profile to the form-field shape. `partial` keeps only keys that are present in `p`. */
function pfFieldsOf(p: Partial<Profile>, partial = false): PfFields {
  const out: Partial<PfFields> = {}
  const has = (k: string) => !partial || k in p
  if (has('first_name'))     out.fname = p.first_name    || ''
  if (has('last_name'))      out.lname = p.last_name     || ''
  if (has('address_line1'))  out.addr  = p.address_line1 || ''
  if (has('city'))           out.city  = p.city          || ''
  if (has('state'))          out.state = p.state         || ''
  if (has('pincode') || has('postal_code')) out.pin = p.pincode || p.postal_code || ''
  if (has('phone'))          out.phone = (p.phone || '').replace(/^\+91/, '')
  return partial ? (out as PfFields) : { ...EMPTY_PF, ...out }
}

// markExpired is optional so the hook stays usable in isolation (tests, Storybook).
// page.tsx passes auth.markExpired so a mid-session 401 surfaces the expired banner.
export function useProfile(
  profile: Profile | null,
  updateLocalProfile: (u: Partial<Profile>) => void,
  toast: (msg: string, type?: 'success' | 'error') => void,
  markExpired?: () => void,
) {
  const [pf,    setPf]    = useState<PfFields>({ ...EMPTY_PF })
  // Profile values the form was last synced to (or that this hook wrote itself) — see syncFromProfile.
  const baseline = useRef<PfFields | null>(null)
  const [pw,    setPw]    = useState({ curp: '', newp: '', conf: '', showCur: false, showNew: false, showConf: false })
  const [pfErr, setPfErr] = useState<FormErrors>({})
  const [msg,   setMsg]   = useState<Record<string, string>>({})
  const [busy,  setBusy]  = useState<Record<string, boolean>>({})

  const [forgotPwSent, setForgotPwSent] = useState(false)
  const msgTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  useEffect(() => () => { msgTimers.current.forEach(t => clearTimeout(t)); msgTimers.current.clear() }, [])

  function setMsg$(key: string, val: string) {
    const existing = msgTimers.current.get(key)
    if (existing) clearTimeout(existing)
    setMsg(m => ({ ...m, [key]: val }))
    const t = setTimeout(() => setMsg(m => ({ ...m, [key]: '' })), 2500)
    msgTimers.current.set(key, t)
  }

  // Centralised error handler: surfaces session-expired banner on 401,
  // falls back to toast for all other errors.
  function handleError(e: unknown, fallback: string) {
    if (e instanceof ServiceError && e.status === 401) {
      markExpired?.()
    } else {
      toast(e instanceof Error ? e.message : fallback, 'error')
    }
  }

  // ── Address CRUD — delegated to shared hook ────────────────
  // useAddresses is the single source of truth for form state, validation,
  // duplicate detection, and busy flags. We wire persistence here so it
  // can perform the optimistic update + rollback pattern used elsewhere.
  const addresses = useAddresses({
    getCurrentAddresses: () => getSavedAddresses(profile),
    persist: async (updated) => {
      await updateProfile({ saved_addresses: JSON.stringify(updated) })
      // AUDIT E1-1: the list rendered by AddressSection and read by the NEXT save comes from the local profile.
      // Add/edit never refreshed it (only remove() applied optimisticUpdate), so the saved address never appeared
      // and the next save was based on a stale list and silently dropped it. Mirror the server state locally.
      updateLocalProfile({ saved_addresses: JSON.stringify(updated) })
      // AUDIT E1-7: checkout prefills from pr_checkout_profile — drop it so it can't offer an old/deleted address.
      clearProfileCache()
    },
    optimisticUpdate: (updated) => {
      updateLocalProfile({ saved_addresses: JSON.stringify(updated) })
    },
    rollback: (previous) => {
      updateLocalProfile({ saved_addresses: JSON.stringify(previous) })
    },
    showToast: toast,
  })

  // initFromProfile is called by the effect in page.tsx whenever auth.profile
  // changes (first load + mid-session server-side updates detected via profileSig).
  // The useCallback dep array is intentionally empty: setPf is stable and the
  // function itself does not read any outer scope that could become stale — it
  // receives the full profile snapshot as its argument every time it is called.
  const initFromProfile = useCallback((p: Profile) => {
    const f = pfFieldsOf(p)
    baseline.current = f
    setPf(f)
  }, [])

  // AUDIT E1-3: saving or rolling back ONE card changes the local profile; re-initialising the whole form from it
  // wiped unsaved edits in the OTHER cards (and a failed save discarded what the user had just typed). Only fields
  // whose profile value changed EXTERNALLY (vs the baseline we last synced/wrote ourselves) are copied in.
  const syncFromProfile = useCallback((p: Profile) => {
    const next = pfFieldsOf(p)
    const base = baseline.current
    if (!base) { baseline.current = next; setPf(next); return }
    const changed = (Object.keys(next) as (keyof PfFields)[]).filter(k => next[k] !== base[k])
    baseline.current = next
    if (changed.length === 0) return
    setPf(cur => {
      const out = { ...cur }
      for (const k of changed) out[k] = next[k]
      return out
    })
  }, [])

  /** Local profile write made by this hook itself: advance the baseline so it is not mistaken for an external change. */
  function ownWrite(u: Partial<Profile>) {
    const patch = pfFieldsOf(u as Profile, true)
    baseline.current = { ...(baseline.current ?? { ...EMPTY_PF }), ...patch }
    updateLocalProfile(u)
  }

  async function saveName() {
    const errors = validateProfileName(pf.fname)
    if (Object.keys(errors).length) { setPfErr(errors); return }
    setPfErr({})
    setBusy(b => ({ ...b, name: true }))
    const up = { first_name: pf.fname.trim(), last_name: pf.lname.trim() }
    ownWrite(up)   // optimistic
    try {
      await updateProfile(up)
      clearProfileCache()   // AUDIT E1-7: checkout must not prefill the pre-edit details
      setMsg$('name', '✅ Name saved!')
    } catch (e: unknown) {
      if (profile) ownWrite({ first_name: profile.first_name, last_name: profile.last_name }) // rollback
      handleError(e, 'Failed to save name')
    } finally {
      setBusy(b => ({ ...b, name: false }))
    }
  }

  async function saveAddress() {
    const errors = validateAddress({ addr: pf.addr, city: pf.city, state: pf.state, pin: pf.pin })
    if (Object.keys(errors).length) { setPfErr(errors); return }
    setPfErr({})
    setBusy(b => ({ ...b, addr: true }))
    const up = { address_line1: pf.addr.trim(), city: pf.city.trim(), state: pf.state, pincode: pf.pin }
    ownWrite(up)   // optimistic
    try {
      await updateProfile(up)
      clearProfileCache()   // AUDIT E1-7: checkout must not prefill the pre-edit details
      setMsg$('addr', '✅ Address saved!')
    } catch (e: unknown) {
      if (profile) ownWrite({ address_line1: profile.address_line1, city: profile.city, state: profile.state, pincode: profile.pincode ?? profile.postal_code }) // rollback
      handleError(e, 'Failed to save address')
    } finally {
      setBusy(b => ({ ...b, addr: false }))
    }
  }

  async function savePhone() {
    const errors = validatePhone(pf.phone)
    if (Object.keys(errors).length) { setPfErr(errors); return }
    setPfErr({})
    setBusy(b => ({ ...b, phone: true }))
    const normalized = '+91' + pf.phone.replace(/\D/g, '')
    ownWrite({ phone: normalized })   // optimistic
    try {
      await updateProfile({ phone: normalized })
      clearProfileCache()   // AUDIT E1-7: checkout must not prefill the pre-edit details
      setMsg$('phone', '✅ Phone saved!')
    } catch (e: unknown) {
      if (profile) ownWrite({ phone: profile.phone }) // rollback
      handleError(e, 'Failed to save phone')
    } finally {
      setBusy(b => ({ ...b, phone: false }))
    }
  }

  async function changePassword() {
    const errors = validatePassword(pw.newp, pw.conf)
    if (Object.keys(errors).length) { setPfErr(errors); return }
    if (!pw.curp) { setPfErr({ curp: 'Current password is required' }); return }
    setPfErr({})
    setBusy(b => ({ ...b, pw: true }))
    try {
      await apiChangePassword(pw.curp, pw.newp)
      setPw({ curp: '', newp: '', conf: '', showCur: false, showNew: false, showConf: false })
      toast('✅ Password updated!')
      ga4AccountAction('password_changed')
    } catch (e: unknown) {
      handleError(e, 'Failed to update password')
    } finally {
      setBusy(b => ({ ...b, pw: false }))
    }
  }

  async function sendForgotPassword() {
    const email = profile?.email || ''
    if (!email) {
      toast('No email linked to this account — cannot send reset link', 'error')
      return
    }
    setBusy(b => ({ ...b, forgotPw: true }))
    try {
      await sendForgotPasswordEmail(email)
      setForgotPwSent(true)
      toast('📧 Reset link sent to ' + email)
    } catch (e: unknown) {
      // BUG FIX [ERROR HANDLING]: previously bare `catch` with no logging.
      // If the forgot-password API call fails (Resend down, network error, etc.)
      // there was zero trace — only the user's toast. Added console.error so
      // ops can distinguish real failures from expected "email not found" responses.
      console.error('[useProfile] sendForgotPassword failed:', e)
      toast('Failed to send reset link — please try again', 'error')
    } finally {
      setBusy(b => ({ ...b, forgotPw: false }))
    }
  }

  return {
    pf, setPf, pfErr, setPfErr, pw, setPw, msg, busy,
    forgotPwSent, sendForgotPassword,
    profileEmail: profile?.email || '',
    addresses,
    initFromProfile, syncFromProfile, saveName, saveAddress, savePhone, changePassword,
  }
}
