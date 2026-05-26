'use client'
// ─────────────────────────────────────────────────────────────
// useProfile — form state + mutations only
//  ✅ Uses profileService (retry, timeout, zod)
//  ✅ Optimistic update + rollback on failure
//  ✅ Timer cleanup on unmount
//  ✅ Address CRUD delegated to shared useAddresses hook
// ─────────────────────────────────────────────────────────────

import { useState, useRef, useEffect, useCallback } from 'react'
import { captureError } from '@/lib/logger'
import {
  validateProfileName, validateAddress, validatePhone,
  validatePassword, FormErrors,
} from '@/lib/account/validation'
import { getSavedAddresses, type SavedAddress } from '@/lib/account/utils'
import { updateProfile, changePassword as apiChangePassword, sendForgotPasswordEmail, ServiceError } from '@/lib/services/profileService'
import { useAddresses } from './useAddresses'
import type { Profile } from './useAuth'

// markExpired is optional so the hook stays usable in isolation (tests, Storybook).
// page.tsx passes auth.markExpired so a mid-session 401 surfaces the expired banner.
export function useProfile(
  profile: Profile | null,
  updateLocalProfile: (u: Partial<Profile>) => void,
  toast: (msg: string, type?: 'success' | 'error') => void,
  markExpired?: () => void,
) {
  const [pf,    setPf]    = useState({ fname: '', lname: '', addr: '', city: '', state: '', pin: '', phone: '' })
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
    },
    optimisticUpdate: (updated) => {
      updateLocalProfile({ saved_addresses: JSON.stringify(updated) })
    },
    rollback: (previous) => {
      updateLocalProfile({ saved_addresses: JSON.stringify(previous) })
    },
    showToast: toast,
  })

  const initFromProfile = useCallback((p: Profile) => {
    setPf({
      fname: p.first_name    || '',
      lname: p.last_name     || '',
      addr:  p.address_line1 || '',
      city:  p.city          || '',
      state: p.state         || '',
      pin:   p.postal_code   || '',
      phone: (p.phone || '').replace(/^\+91/, ''),
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally empty — only runs once on mount to populate from profile

  async function saveName() {
    const errors = validateProfileName(pf.fname)
    if (Object.keys(errors).length) { setPfErr(errors); return }
    setPfErr({})
    setBusy(b => ({ ...b, name: true }))
    const up = { first_name: pf.fname.trim(), last_name: pf.lname.trim() }
    updateLocalProfile(up)   // optimistic
    try {
      await updateProfile(up)
      setMsg$('name', '✅ Name saved!')
    } catch (e: unknown) {
      if (profile) updateLocalProfile({ first_name: profile.first_name, last_name: profile.last_name }) // rollback
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
    const up = { address_line1: pf.addr.trim(), city: pf.city.trim(), state: pf.state, postal_code: pf.pin }
    updateLocalProfile(up)   // optimistic
    try {
      await updateProfile(up)
      setMsg$('addr', '✅ Address saved!')
    } catch (e: unknown) {
      if (profile) updateLocalProfile({ address_line1: profile.address_line1, city: profile.city, state: profile.state, postal_code: profile.postal_code }) // rollback
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
    updateLocalProfile({ phone: normalized })   // optimistic
    try {
      await updateProfile({ phone: normalized })
      setMsg$('phone', '✅ Phone saved!')
    } catch (e: unknown) {
      if (profile) updateLocalProfile({ phone: profile.phone }) // rollback
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
    } catch {
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
    initFromProfile, saveName, saveAddress, savePhone, changePassword,
  }
}
