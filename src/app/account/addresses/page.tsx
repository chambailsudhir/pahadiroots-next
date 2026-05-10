'use client'
// ─────────────────────────────────────────────────────────────
// /account/addresses — standalone addresses page
// Fixed:
//  ✅ Uses /api/profile (cookie auth) — not /api/v1/cart
//  ✅ crypto.randomUUID for IDs (not array index)
//  ✅ Same field schema as main account page (addr not flat/area)
//  ✅ Max 10 addresses (consistent with AddressSection)
//  ✅ Duplicate detection before save
//  ✅ No `as any` type suppression
//  ✅ No mounted anti-pattern
//  ✅ Proper error handling
// ─────────────────────────────────────────────────────────────
import { useEffect, useState, useCallback } from 'react'
import { INDIA_STATES, ADDRESS_LABELS } from '@/lib/account/constants'
import { updateProfile } from '@/lib/services/profileService'
import type { SavedAddress } from '@/app/account/hooks/useProfile'

const EMPTY_FORM = { label: 'Home', name: '', addr: '', city: '', state: 'Uttarakhand', pin: '' }

export default function AddressesPage() {
  const [addresses, setAddresses] = useState<SavedAddress[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [saving,    setSaving]    = useState(false)
  const [toast,     setToast]     = useState('')
  const [showForm,  setShowForm]  = useState(false)
  const [editId,    setEditId]    = useState<string | null>(null)
  const [form,      setForm]      = useState(EMPTY_FORM)
  const [formErr,   setFormErr]   = useState<Record<string, string>>({})

  // Load addresses from profile API
  useEffect(() => {
    const ctrl = new AbortController()
    fetch('/api/profile', { signal: ctrl.signal })
      .then(async r => {
        if (!r.ok) throw new Error('Could not load addresses')
        const data = await r.json()
        const raw  = data.profile?.saved_addresses
        try { setAddresses(raw ? JSON.parse(raw) : []) } catch { setAddresses([]) }
      })
      .catch(e => { if (!ctrl.signal.aborted) setError(e?.message || 'Failed to load') })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false) })
    return () => ctrl.abort()
  }, [])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!form.label)        e.label = 'Please select a label'
    if (!form.addr.trim())  e.addr  = 'Street address is required'
    if (!form.city.trim())  e.city  = 'City is required'
    if (!form.state)        e.state = 'Please select a state'
    if (form.pin && !/^\d{6}$/.test(form.pin)) e.pin = 'Enter a valid 6-digit pincode'
    setFormErr(e)
    return Object.keys(e).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    try {
      let updated: SavedAddress[]
      if (editId) {
        // Edit existing
        updated = addresses.map(a => a.id === editId
          ? { ...a, ...form }
          : a
        )
      } else {
        // New address
        if (addresses.length >= 10) {
          showToast('Maximum 10 addresses allowed. Remove one first.')
          return
        }
        // Duplicate check
        const isDuplicate = addresses.some(a =>
          a.addr.trim().toLowerCase() === form.addr.trim().toLowerCase() &&
          a.city.trim().toLowerCase() === form.city.trim().toLowerCase() &&
          a.pin === form.pin
        )
        if (isDuplicate) { showToast('This address already exists.'); return }

        const newEntry: SavedAddress = { id: crypto.randomUUID(), ...form }
        updated = [...addresses, newEntry]
      }

      await updateProfile({ saved_addresses: JSON.stringify(updated) })
      setAddresses(updated)
      setShowForm(false)
      setEditId(null)
      setForm(EMPTY_FORM)
      setFormErr({})
      showToast(editId ? '✅ Address updated!' : '✅ Address saved!')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to save address')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    const updated = addresses.filter(a => a.id !== id)
    try {
      await updateProfile({ saved_addresses: JSON.stringify(updated) })
      setAddresses(updated)
      showToast('Address removed')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to remove address')
    }
  }

  function startEdit(addr: SavedAddress) {
    setForm({ label: addr.label, name: addr.name, addr: addr.addr, city: addr.city, state: addr.state, pin: addr.pin })
    setEditId(addr.id)
    setShowForm(true)
    setFormErr({})
  }

  function cancelForm() {
    setShowForm(false)
    setEditId(null)
    setForm(EMPTY_FORM)
    setFormErr({})
  }

  function setField(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
    setFormErr(e => ({ ...e, [field]: '' }))
  }

  if (loading) return (
    <div className="space-y-3">
      {[1,2].map(i => <div key={i} className="h-24 bg-stone-100 animate-pulse rounded-xl" />)}
    </div>
  )

  if (error) return (
    <div className="text-center py-16 text-red-500 text-sm">{error}</div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-bold text-stone-900">Saved Addresses</h1>
        {!showForm && addresses.length < 10 && (
          <button
            onClick={() => { setForm(EMPTY_FORM); setEditId(null); setShowForm(true) }}
            className="text-sm font-semibold text-green-700 hover:text-green-900 flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add New
          </button>
        )}
      </div>

      {/* Add / Edit form */}
      {showForm && (
        <div className="bg-white border border-stone-200 rounded-2xl p-5 mb-5">
          <h2 className="text-sm font-bold text-stone-800 mb-4">
            {editId ? 'Edit Address' : 'New Address'}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Label */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-stone-600 mb-1">Label *</label>
              <select
                value={form.label}
                onChange={e => setField('label', e.target.value)}
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-green-500 bg-white"
              >
                <option value="">Select label…</option>
                {ADDRESS_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              {formErr.label && <p className="text-xs text-red-500 mt-1">{formErr.label}</p>}
            </div>
            {/* Contact name */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-stone-600 mb-1">Contact Name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setField('name', e.target.value)}
                placeholder="Full name at this address"
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-green-500"
              />
            </div>
            {/* Street */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-stone-600 mb-1">Street / Flat / Colony *</label>
              <input
                type="text"
                value={form.addr}
                onChange={e => setField('addr', e.target.value)}
                placeholder="House no., Street, Colony"
                className={`w-full border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-green-500 ${formErr.addr ? 'border-red-400' : 'border-stone-200'}`}
              />
              {formErr.addr && <p className="text-xs text-red-500 mt-1">{formErr.addr}</p>}
            </div>
            {/* City */}
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1">City *</label>
              <input
                type="text"
                value={form.city}
                onChange={e => setField('city', e.target.value)}
                placeholder="Dehradun"
                className={`w-full border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-green-500 ${formErr.city ? 'border-red-400' : 'border-stone-200'}`}
              />
              {formErr.city && <p className="text-xs text-red-500 mt-1">{formErr.city}</p>}
            </div>
            {/* Pincode */}
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1">Pincode</label>
              <input
                type="text"
                inputMode="numeric"
                value={form.pin}
                onChange={e => setField('pin', e.target.value.replace(/\D/g, ''))}
                placeholder="248001"
                maxLength={6}
                className={`w-full border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-green-500 ${formErr.pin ? 'border-red-400' : 'border-stone-200'}`}
              />
              {formErr.pin && <p className="text-xs text-red-500 mt-1">{formErr.pin}</p>}
            </div>
            {/* State */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-stone-600 mb-1">State *</label>
              <select
                value={form.state}
                onChange={e => setField('state', e.target.value)}
                className={`w-full border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-green-500 bg-white ${formErr.state ? 'border-red-400' : 'border-stone-200'}`}
              >
                <option value="">Select State / UT</option>
                {INDIA_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {formErr.state && <p className="text-xs text-red-500 mt-1">{formErr.state}</p>}
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-green-900 hover:bg-green-800 text-white font-bold py-2.5 rounded-xl text-sm disabled:opacity-60 transition-colors"
            >
              {saving ? 'Saving…' : editId ? 'Update Address' : 'Save Address'}
            </button>
            <button
              onClick={cancelForm}
              className="px-5 py-2.5 border border-stone-200 text-stone-600 rounded-xl text-sm hover:bg-stone-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {addresses.length === 0 && !showForm ? (
        <div className="text-center py-12 border border-dashed border-stone-200 rounded-2xl">
          <div className="text-3xl mb-3">📍</div>
          <p className="text-stone-400 text-sm mb-3">No saved addresses yet</p>
          <button
            onClick={() => { setForm(EMPTY_FORM); setEditId(null); setShowForm(true) }}
            className="text-green-700 text-sm font-semibold hover:underline"
          >
            Add your first address
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {addresses.map(addr => (
            <div key={addr.id} className="bg-white border border-stone-200 rounded-xl p-4 flex items-start justify-between gap-4">
              <div>
                <span className="text-xs font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-full inline-block mb-1">
                  {addr.label || 'Home'}
                </span>
                {addr.name && <div className="text-sm font-semibold text-stone-800">{addr.name}</div>}
                <div className="text-sm text-stone-600">{addr.addr}</div>
                <div className="text-sm text-stone-500">{[addr.city, addr.state, addr.pin].filter(Boolean).join(', ')}</div>
              </div>
              <div className="flex gap-3 shrink-0">
                <button
                  onClick={() => startEdit(addr)}
                  className="text-xs font-semibold text-stone-500 hover:text-green-700 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(addr.id)}
                  className="text-xs font-semibold text-stone-500 hover:text-red-500 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-green-900 text-white text-sm font-semibold px-5 py-3 rounded-xl shadow-lg z-50 whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  )
}
