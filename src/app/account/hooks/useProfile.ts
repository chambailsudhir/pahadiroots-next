// ─────────────────────────────────────────────────────────────
// useProfile — all profile/address/password mutations
//
// FIXES applied (audit):
//  ✅ setMsg$ timeout now cleaned up on unmount (was leaking)
//  ✅ profile typed as Profile (no more `any`)
//  ✅ token null-guard before API calls (no more token! assertion)
//  ✅ New address objects get stable IDs for React key stability
//  ✅ Error logging added to all catch blocks
//
// KNOWN LIMITATIONS (require product/backend decisions):
//  ⚠️  Password flow missing "current password" field — requires
//      backend reauthentication endpoint support first.
//  ⚠️  Brute-force protection is a backend concern (rate limiting).
//  ⚠️  State fragmentation (pf/pw/busy/msg) is an intentional
//      tradeoff — grouping them would require full reducer refactor
//      with no user-visible benefit at current scale.
// ─────────────────────────────────────────────────────────────
'use client'

import { useState, useRef, useEffect } from 'react'
import { accountApi, storage } from '@/lib/account/api'
import {
  validateProfileName, validateAddress, validatePhone,
  validatePassword, validateNewAddress, FormErrors,
} from '@/lib/account/validation'
import { getSavedAddresses } from '@/lib/account/utils'
import type { Profile } from './useAuth'

// ── Stable address type ───────────────────────────────────────
export interface SavedAddress {
  id:     string   // stable ID for React keys
  label:  string
  name:   string
  addr:   string
  city:   string
  state:  string
  pin:    string
}

export function useProfile(
  token: string | null,
  profile: Profile | null,
  updateLocalProfile: (u: Partial<Profile>) => void,
  toast: (msg: string, type?: 'success' | 'error') => void,
) {
  // ── Form state ────────────────────────────────────────────
  const [pf, setPf] = useState({
    fname: '', lname: '', addr: '', city: '', state: '', pin: '', phone: '',
  })
  const [pw,     setPw]     = useState({ newp: '', conf: '', showNew: false, showConf: false })
  const [pfErr,  setPfErr]  = useState<FormErrors>({})
  const [msg,    setMsg]    = useState<Record<string, string>>({})
  const [busy,   setBusy]   = useState<Record<string, boolean>>({})

  // ── New address form state ────────────────────────────────
  const [showAddAddr, setShowAddAddr] = useState(false)
  const [newAddr,     setNewAddr]     = useState({ label: '', name: '', flat: '', city: '', state: '', pin: '' })
  const [newAddrErr,  setNewAddrErr]  = useState<FormErrors>({})

  // ── Message timeout tracking — prevents leak on unmount ───
  const msgTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    return () => {
      // Clear all pending message timers on unmount
      msgTimers.current.forEach(t => clearTimeout(t))
      msgTimers.current.clear()
    }
  }, [])

  function setMsg$(key: string, val: string) {
    // Clear existing timer for this key before setting new one
    const existing = msgTimers.current.get(key)
    if (existing) clearTimeout(existing)

    setMsg(m => ({ ...m, [key]: val }))
    const t = setTimeout(() => setMsg(m => ({ ...m, [key]: '' })), 2500)
    msgTimers.current.set(key, t)
  }

  function initFromProfile(p: Profile) {
    setPf({
      fname: p.first_name    || '',
      lname: p.last_name     || '',
      addr:  p.address_line1 || '',
      city:  p.city          || '',
      state: p.state         || '',
      pin:   p.postal_code   || '',
      phone: (p.phone || '').replace(/^\+91/, ''),
    })
  }

  // ── Token guard helper ────────────────────────────────────
  function requireToken(): string | null {
    if (!token) {
      toast('Session expired. Please log in again.', 'error')
      return null
    }
    return token
  }

  // ── Save handlers ─────────────────────────────────────────
  async function saveName() {
    const errors = validateProfileName(pf.fname)
    if (Object.keys(errors).length) { setPfErr(errors); return }
    const tk = requireToken(); if (!tk) return
    setPfErr({})
    setBusy(b => ({ ...b, name: true }))
    try {
      const up = { first_name: pf.fname.trim(), last_name: pf.lname.trim() }
      await accountApi.updateProfile(tk, up)
      updateLocalProfile(up)
      setMsg$('name', '✅ Name saved!')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to save name'
      console.error('[useProfile] saveName:', e)
      toast(msg, 'error')
    } finally {
      setBusy(b => ({ ...b, name: false }))
    }
  }

  async function saveAddress() {
    const errors = validateAddress({ addr: pf.addr, city: pf.city, state: pf.state, pin: pf.pin })
    if (Object.keys(errors).length) { setPfErr(errors); return }
    const tk = requireToken(); if (!tk) return
    setPfErr({})
    setBusy(b => ({ ...b, addr: true }))
    try {
      const up = { address_line1: pf.addr.trim(), city: pf.city.trim(), state: pf.state, postal_code: pf.pin }
      await accountApi.updateProfile(tk, up)
      updateLocalProfile(up)
      setMsg$('addr', '✅ Address saved!')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to save address'
      console.error('[useProfile] saveAddress:', e)
      toast(msg, 'error')
    } finally {
      setBusy(b => ({ ...b, addr: false }))
    }
  }

  async function savePhone() {
    const errors = validatePhone(pf.phone)
    if (Object.keys(errors).length) { setPfErr(errors); return }
    const tk = requireToken(); if (!tk) return
    setPfErr({})
    setBusy(b => ({ ...b, phone: true }))
    try {
      const normalized = '+91' + pf.phone.replace(/\D/g, '')
      await accountApi.updateProfile(tk, { phone: normalized })
      updateLocalProfile({ phone: normalized })
      setMsg$('phone', '✅ Phone saved!')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to save phone'
      console.error('[useProfile] savePhone:', e)
      toast(msg, 'error')
    } finally {
      setBusy(b => ({ ...b, phone: false }))
    }
  }

  async function changePassword() {
    const errors = validatePassword(pw.newp, pw.conf)
    if (Object.keys(errors).length) { setPfErr(errors); return }
    const tk = requireToken(); if (!tk) return
    setPfErr({})
    setBusy(b => ({ ...b, pw: true }))
    try {
      await accountApi.changePassword(tk, pw.newp)
      setPw({ newp: '', conf: '', showNew: false, showConf: false })
      toast('✅ Password updated!')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to update password'
      console.error('[useProfile] changePassword:', e)
      toast(msg, 'error')
    } finally {
      setBusy(b => ({ ...b, pw: false }))
    }
  }

  async function saveNewAddress() {
    const errors = validateNewAddress(newAddr)
    if (Object.keys(errors).length) { setNewAddrErr(errors); return }
    const tk = requireToken(); if (!tk) return
    setNewAddrErr({})
    setBusy(b => ({ ...b, newAddr: true }))
    try {
      const existing = getSavedAddresses(profile)
      // ✅ Assign stable ID to new address — prevents React key instability
      const newEntry: SavedAddress = {
        id:    `addr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        label: newAddr.label,
        name:  newAddr.name.trim(),
        addr:  newAddr.flat.trim(),
        city:  newAddr.city.trim(),
        state: newAddr.state,
        pin:   newAddr.pin,
      }
      const updated = [...existing, newEntry]
      const saved   = JSON.stringify(updated)
      await accountApi.updateProfile(tk, { saved_addresses: saved })
      updateLocalProfile({ saved_addresses: saved })
      setNewAddr({ label: '', name: '', flat: '', city: '', state: '', pin: '' })
      setShowAddAddr(false)
      toast('✅ Address saved!')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to save address'
      console.error('[useProfile] saveNewAddress:', e)
      toast(msg, 'error')
    } finally {
      setBusy(b => ({ ...b, newAddr: false }))
    }
  }

  async function deleteAddress(label: string) {
    const tk = requireToken(); if (!tk) return
    try {
      const updated = getSavedAddresses(profile).filter((a: SavedAddress) => a.label !== label)
      const saved   = JSON.stringify(updated)
      await accountApi.updateProfile(tk, { saved_addresses: saved })
      updateLocalProfile({ saved_addresses: saved })
      toast('Address removed')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to remove address'
      console.error('[useProfile] deleteAddress:', e)
      toast(msg, 'error')
    }
  }

  return {
    pf, setPf, pfErr, setPfErr, pw, setPw, msg, busy,
    showAddAddr, setShowAddAddr, newAddr, setNewAddr, newAddrErr, setNewAddrErr,
    initFromProfile, saveName, saveAddress, savePhone, changePassword,
    saveNewAddress, deleteAddress,
  }
}
