'use client'
// ─────────────────────────────────────────────────────────────
// useAddresses — single source of truth for address CRUD
//
// Consumed by BOTH:
//   • /account main page (AddressSection via useProfile)
//   • /account/addresses standalone page
//
// The hook owns all form state, validation, duplicate detection,
// the 10-address limit, and busy flags.
//
// The CALLER owns data persistence:
//   • persist(updated)        — API call (+ state update for standalone)
//   • optimisticUpdate?()     — applied before persist (main account)
//   • rollback?()             — applied if persist throws (main account)
//
// Using a config ref (cfg) ensures async callbacks always read the
// latest values even after re-renders without needing useCallback deps.
// ─────────────────────────────────────────────────────────────

import { useState, useRef, useEffect } from 'react'
import { validateNewAddress } from '@/lib/account/validation'
import type { FormErrors }    from '@/lib/account/validation'
import type { SavedAddress }  from './useProfile'

export const EMPTY_ADDRESS_FORM = {
  label: '', name: '', addr: '', city: '', state: '', pin: '',
}
export type AddressForm = typeof EMPTY_ADDRESS_FORM

interface AddressesConfig {
  /** Always returns the current live list — used by async ops to avoid stale closures. */
  getCurrentAddresses: () => SavedAddress[]
  /** Persist the new list to the server (and update caller state for standalone). */
  persist: (updated: SavedAddress[]) => Promise<void>
  /** Optimistic update applied BEFORE the API call (main account page only). */
  optimisticUpdate?: (updated: SavedAddress[]) => void
  /** Rollback applied if persist() throws (main account page only). */
  rollback?: (previous: SavedAddress[]) => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}

export function useAddresses(config: AddressesConfig) {
  // Keep config in a ref so async handlers always have the latest version.
  const cfg = useRef(config)
  useEffect(() => { cfg.current = config })

  const [form,            setFormState]       = useState<AddressForm>(EMPTY_ADDRESS_FORM)
  const [formErr,         setFormErr]         = useState<FormErrors>({})
  const [editId,          setEditId]          = useState<string | null>(null)
  const [showForm,        setShowForm]        = useState(false)
  const [saving,          setSaving]          = useState(false)
  const [deletingId,      setDeletingId]      = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  function setField(field: keyof AddressForm, value: string) {
    setFormState(f => ({ ...f, [field]: value }))
    setFormErr(e  => ({ ...e,  [field]: '' }))
  }

  function startAdd() {
    setFormState(EMPTY_ADDRESS_FORM)
    setEditId(null)
    setFormErr({})
    setConfirmDeleteId(null)
    setShowForm(true)
  }

  function startEdit(addr: SavedAddress) {
    setFormState({
      label: addr.label, name: addr.name, addr: addr.addr,
      city:  addr.city,  state: addr.state, pin: addr.pin,
    })
    setEditId(addr.id)
    setFormErr({})
    setConfirmDeleteId(null)
    setShowForm(true)
  }

  function cancelForm() {
    setShowForm(false)
    setEditId(null)
    setFormState(EMPTY_ADDRESS_FORM)
    setFormErr({})
    setConfirmDeleteId(null)
  }

  async function save() {
    const { getCurrentAddresses, persist, showToast } = cfg.current
    const current = getCurrentAddresses()

    // validateNewAddress uses 'flat' as the street-address key; remap to 'addr'.
    const raw = validateNewAddress({
      label: form.label, flat: form.addr,
      city:  form.city,  state: form.state, pin: form.pin,
    })
    if (Object.keys(raw).length) {
      const errs: FormErrors = { ...raw }
      if (errs.flat) { errs.addr = errs.flat; delete errs.flat }
      setFormErr(errs)
      return
    }
    setFormErr({})
    setSaving(true)
    try {
      let updated: SavedAddress[]
      if (editId) {
        updated = current.map(a => a.id === editId ? { ...a, ...form } : a)
      } else {
        if (current.length >= 10) {
          showToast('Maximum 10 addresses allowed. Remove one first.', 'error')
          return
        }
        const isDuplicate = current.some(a =>
          a.addr.trim().toLowerCase() === form.addr.trim().toLowerCase() &&
          a.city.trim().toLowerCase() === form.city.trim().toLowerCase() &&
          a.pin === form.pin
        )
        if (isDuplicate) { showToast('This address already exists.', 'error'); return }
        updated = [...current, { id: crypto.randomUUID(), ...form }]
      }
      await persist(updated)
      showToast(editId ? '✅ Address updated!' : '✅ Address saved!')
      cancelForm()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to save address', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (deletingId) return   // prevent concurrent deletes (double-tap)
    const { getCurrentAddresses, persist, optimisticUpdate, rollback, showToast } = cfg.current
    setDeletingId(id)
    const previous = getCurrentAddresses()
    const updated  = previous.filter(a => a.id !== id)
    optimisticUpdate?.(updated)   // instant UI update on main account page
    try {
      await persist(updated)
      showToast('Address removed')
    } catch (e: unknown) {
      rollback?.(previous)        // restore snapshot on main account page
      showToast(e instanceof Error ? e.message : 'Failed to remove address', 'error')
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  return {
    form, formErr, editId, showForm, saving, deletingId, confirmDeleteId,
    setField, startAdd, startEdit, cancelForm, save, remove, setConfirmDeleteId,
  }
}
