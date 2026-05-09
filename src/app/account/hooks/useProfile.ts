// ─────────────────────────────────────────────────────────────
// useProfile — all profile/address/password mutations
//
// FIXES applied (all audit rounds):
//  ✅ All API calls use fetch('/api/profile') — no token passed from client
//     Tokens live in httpOnly cookies, read server-side automatically
//  ✅ change_password now sends current_password for server-side verification
//  ✅ Brute-force protected by rate limiter in /api/auth route (5 req/60s)
//  ✅ setMsg$ timer cleanup on unmount — no memory leak
//  ✅ profile typed as Profile — no any
//  ✅ Stable address IDs for React key stability
//  ✅ All catch blocks log with console.error
// ─────────────────────────────────────────────────────────────
'use client'

import { useState, useRef, useEffect } from 'react'
import {
  validateProfileName, validateAddress, validatePhone,
  validatePassword, validateNewAddress, FormErrors,
} from '@/lib/account/validation'
import { getSavedAddresses } from '@/lib/account/utils'
import type { Profile } from './useAuth'

// ── API helpers — all calls go to /api/profile (cookie-based auth) ──
async function apiProfile(updates: Record<string, unknown>) {
  const res = await fetch('/api/profile', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(updates),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error || `Request failed (${res.status})`)
  }
  return res.json()
}

async function apiChangePassword(currentPassword: string, newPassword: string) {
  const res = await fetch('/api/auth', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      action:           'change_password',
      current_password: currentPassword,
      new_password:     newPassword,
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error || `Password update failed (${res.status})`)
  }
  return res.json()
}

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
  profile: Profile | null,
  updateLocalProfile: (u: Partial<Profile>) => void,
  toast: (msg: string, type?: 'success' | 'error') => void,
) {
  // ── Form state ────────────────────────────────────────────
  const [pf, setPf] = useState({
    fname: '', lname: '', addr: '', city: '', state: '', pin: '', phone: '',
  })
  const [pw,     setPw]     = useState({ curp: '', newp: '', conf: '', showCur: false, showNew: false, showConf: false })
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

  // ── Save handlers — no token needed, cookie sent automatically ──
  async function saveName() {
    const errors = validateProfileName(pf.fname)
    if (Object.keys(errors).length) { setPfErr(errors); return }
    setPfErr({})
    setBusy(b => ({ ...b, name: true }))
    try {
      const up = { first_name: pf.fname.trim(), last_name: pf.lname.trim() }
      await apiProfile(up)
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
    setPfErr({})
    setBusy(b => ({ ...b, addr: true }))
    try {
      const up = { address_line1: pf.addr.trim(), city: pf.city.trim(), state: pf.state, postal_code: pf.pin }
      await apiProfile(up)
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
    setPfErr({})
    setBusy(b => ({ ...b, phone: true }))
    try {
      const normalized = '+91' + pf.phone.replace(/\D/g, '')
      await apiProfile({ phone: normalized })
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

  // ✅ current_password now required — verified server-side with reauthentication
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
    setNewAddrErr({})
    setBusy(b => ({ ...b, newAddr: true }))
    try {
      const existing = getSavedAddresses(profile)
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
      await apiProfile({ saved_addresses: saved })
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
    try {
      const updated = getSavedAddresses(profile).filter((a: SavedAddress) => a.label !== label)
      const saved   = JSON.stringify(updated)
      await apiProfile({ saved_addresses: saved })
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
