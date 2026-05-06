// ─────────────────────────────────────────────────────────────
// useProfile — all profile/address/password mutations
// ─────────────────────────────────────────────────────────────
'use client'

import { useState } from 'react'
import { accountApi, storage } from '@/lib/account/api'
import {
  validateProfileName, validateAddress, validatePhone,
  validatePassword, validateNewAddress, FormErrors,
} from '@/lib/account/validation'
import { getSavedAddresses } from '@/lib/account/utils'

export function useProfile(
  token: string | null,
  profile: any,
  updateLocalProfile: (u: any) => void,
  toast: (msg: string, type?: 'success' | 'error') => void,
) {
  // ── Form state ───────────────────────────────────────────────
  const [pf, setPf] = useState({
    fname: '', lname: '', addr: '', city: '', state: '', pin: '', phone: '',
  })
  const [pw,  setPw]  = useState({ newp: '', conf: '', showNew: false, showConf: false })
  const [pfErr, setPfErr] = useState<FormErrors>({})
  const [msg,  setMsg]  = useState<Record<string,string>>({})
  const [busy, setBusy] = useState<Record<string,boolean>>({})

  // ── New address form state ───────────────────────────────────
  const [showAddAddr,  setShowAddAddr]  = useState(false)
  const [newAddr,      setNewAddr]      = useState({ label: '', name: '', flat: '', city: '', state: '', pin: '' })
  const [newAddrErr,   setNewAddrErr]   = useState<FormErrors>({})

  function setMsg$(key: string, val: string) {
    setMsg(m => ({ ...m, [key]: val }))
    setTimeout(() => setMsg(m => ({ ...m, [key]: '' })), 2500)
  }

  function initFromProfile(p: any) {
    if (!p) return
    setPf({
      fname: p.first_name   || '',
      lname: p.last_name    || '',
      addr:  p.address_line1|| '',
      city:  p.city         || '',
      state: p.state        || '',
      pin:   p.postal_code  || '',
      phone: (p.phone || '').replace(/^\+91/, ''),
    })
  }

  // ── Save handlers ────────────────────────────────────────────
  async function saveName() {
    const errors = validateProfileName(pf.fname)
    if (Object.keys(errors).length) { setPfErr(errors); return }
    setPfErr({})
    setBusy(b => ({ ...b, name: true }))
    try {
      const up = { first_name: pf.fname.trim(), last_name: pf.lname.trim() }
      await accountApi.updateProfile(token!, up)
      updateLocalProfile(up)
      setMsg$('name', '✅ Name saved!')
    } catch (e: any) {
      toast(e.message || 'Failed to save name', 'error')
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
      await accountApi.updateProfile(token!, up)
      updateLocalProfile(up)
      setMsg$('addr', '✅ Address saved!')
    } catch (e: any) {
      toast(e.message || 'Failed to save address', 'error')
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
      await accountApi.updateProfile(token!, { phone: normalized })
      updateLocalProfile({ phone: normalized })
      setMsg$('phone', '✅ Phone saved!')
    } catch (e: any) {
      toast(e.message || 'Failed to save phone', 'error')
    } finally {
      setBusy(b => ({ ...b, phone: false }))
    }
  }

  async function changePassword() {
    const errors = validatePassword(pw.newp, pw.conf)
    if (Object.keys(errors).length) { setPfErr(errors); return }
    setPfErr({})
    setBusy(b => ({ ...b, pw: true }))
    try {
      await accountApi.changePassword(token!, pw.newp)
      setPw({ newp: '', conf: '', showNew: false, showConf: false })
      toast('✅ Password updated!')
    } catch (e: any) {
      toast(e.message || 'Failed to update password', 'error')
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
      const updated  = [...existing, {
        label: newAddr.label,
        name:  newAddr.name.trim(),
        addr:  newAddr.flat.trim(),
        city:  newAddr.city.trim(),
        state: newAddr.state,
        pin:   newAddr.pin,
      }]
      const saved = JSON.stringify(updated)
      await accountApi.updateProfile(token!, { saved_addresses: saved })
      updateLocalProfile({ saved_addresses: saved })
      setNewAddr({ label: '', name: '', flat: '', city: '', state: '', pin: '' })
      setShowAddAddr(false)
      toast('✅ Address saved!')
    } catch (e: any) {
      toast(e.message || 'Failed to save address', 'error')
    } finally {
      setBusy(b => ({ ...b, newAddr: false }))
    }
  }

  async function deleteAddress(label: string) {
    try {
      const updated = getSavedAddresses(profile).filter((a: any) => a.label !== label)
      const saved   = JSON.stringify(updated)
      await accountApi.updateProfile(token!, { saved_addresses: saved })
      updateLocalProfile({ saved_addresses: saved })
      toast('Address removed')
    } catch (e: any) {
      console.error('[deleteAddress]', e)
      toast('Failed to remove address', 'error')
    }
  }

  return {
    pf, setPf, pfErr, setPfErr, pw, setPw, msg, busy,
    showAddAddr, setShowAddAddr, newAddr, setNewAddr, newAddrErr, setNewAddrErr,
    initFromProfile, saveName, saveAddress, savePhone, changePassword,
    saveNewAddress, deleteAddress,
  }
}
