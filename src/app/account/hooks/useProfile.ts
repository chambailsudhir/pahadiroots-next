'use client'
// ─────────────────────────────────────────────────────────────
// useProfile — form state + mutations only
//  ✅ Uses profileService (retry, timeout, zod)
//  ✅ Optimistic update + rollback on failure
//  ✅ deleteAddress by ID (not label)
//  ✅ crypto.randomUUID for address IDs
//  ✅ Duplicate address detection
//  ✅ Max 10 addresses limit
//  ✅ Timer cleanup on unmount
// ─────────────────────────────────────────────────────────────

import { useState, useRef, useEffect, useCallback } from 'react'
import { captureError } from '@/lib/logger'
import {
  validateProfileName, validateAddress, validatePhone,
  validatePassword, validateNewAddress, FormErrors,
} from '@/lib/account/validation'
import { getSavedAddresses } from '@/lib/account/utils'
import { updateProfile, changePassword as apiChangePassword, ServiceError } from '@/lib/services/profileService'
import type { Profile } from './useAuth'

export interface SavedAddress {
  id:    string
  label: string
  name:  string
  addr:  string
  city:  string
  state: string
  pin:   string
}

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
  const [showAddAddr, setShowAddAddr] = useState(false)
  const [newAddr,     setNewAddr]     = useState({ label: '', name: '', flat: '', city: '', state: '', pin: '' })
  const [newAddrErr,  setNewAddrErr]  = useState<FormErrors>({})

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

  async function saveNewAddress() {
    const errors = validateNewAddress(newAddr)
    if (Object.keys(errors).length) { setNewAddrErr(errors); return }
    setNewAddrErr({})
    setBusy(b => ({ ...b, newAddr: true }))
    try {
      const existing = getSavedAddresses(profile)
      if (existing.length >= 10) {
        toast('Maximum 10 addresses allowed. Remove one first.', 'error')
        return  // finally block resets busy ✅
      }
      const isDuplicate = existing.some((a: SavedAddress) =>
        a.addr.trim().toLowerCase() === newAddr.flat.trim().toLowerCase() &&
        a.city.trim().toLowerCase() === newAddr.city.trim().toLowerCase() &&
        a.pin === newAddr.pin
      )
      if (isDuplicate) { toast('This address already exists.', 'error'); return } // finally resets busy ✅

      const newEntry: SavedAddress = {
        id: crypto.randomUUID(),
        label: newAddr.label, name: newAddr.name.trim(),
        addr: newAddr.flat.trim(), city: newAddr.city.trim(),
        state: newAddr.state, pin: newAddr.pin,
      }
      const updated = [...existing, newEntry]
      const saved   = JSON.stringify(updated)
      await updateProfile({ saved_addresses: saved })
      updateLocalProfile({ saved_addresses: saved })
      setNewAddr({ label: '', name: '', flat: '', city: '', state: '', pin: '' })
      setShowAddAddr(false)
      toast('✅ Address saved!')
    } catch (e: unknown) {
      handleError(e, 'Failed to save address')
    } finally {
      setBusy(b => ({ ...b, newAddr: false }))  // always runs — covers all early returns too
    }
  }

  async function deleteAddress(id: string) {
    try {
      const updated = getSavedAddresses(profile).filter((a: SavedAddress) => a.id !== id)
      const saved   = JSON.stringify(updated)
      await updateProfile({ saved_addresses: saved })
      updateLocalProfile({ saved_addresses: saved })
      toast('Address removed')
    } catch (e: unknown) {
      handleError(e, 'Failed to remove address')
    }
  }

  return {
    pf, setPf, pfErr, setPfErr, pw, setPw, msg, busy,
    showAddAddr, setShowAddAddr, newAddr, setNewAddr, newAddrErr, setNewAddrErr,
    initFromProfile, saveName, saveAddress, savePhone, changePassword,
    saveNewAddress, deleteAddress,
  }
}
