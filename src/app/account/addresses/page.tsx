'use client'

import { useState } from 'react'
import { useUserStore } from '@/store/userStore'
import type { AddressLabel } from '@/types'

const LABELS: AddressLabel[] = ['Home', 'Office', 'Parents', 'Friends', 'Others']
const INDIA_STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Jammu and Kashmir','Ladakh','Puducherry','Chandigarh']

const EMPTY = { flat: '', area: '', city: '', state: 'Uttarakhand', pincode: '', label: 'Home' as AddressLabel }

export default function AddressesPage() {
  const user           = useUserStore(s => s.user)
  const savedAddresses = useUserStore(s => s.savedAddresses)
  const setAddresses   = useUserStore(s => s.setAddresses)

  const [editing, setEditing] = useState(false)
  const [form, setForm]       = useState(EMPTY)
  const [saving, setSaving]   = useState(false)
  const [editIdx, setEditIdx] = useState<number | null>(null)

  function setField(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSave() {
    if (!form.flat || !form.area || !form.city || !form.pincode) return
    if (!/^\d{6}$/.test(form.pincode)) { alert('Enter valid 6-digit pincode'); return }
    setSaving(true)

    const updated = editIdx !== null
      ? savedAddresses.map((a, i) => i === editIdx ? { ...form } : a)
      : [...savedAddresses, { ...form }].slice(-5)

    // Persist via server API
    try {
      await fetch('/api/v1/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_addresses',
          phone: user?.phone,
          saved_addresses: updated,
        }),
      })
    } catch { /* local fallback is fine */ }

    setAddresses(updated as any)
    setEditing(false)
    setEditIdx(null)
    setForm(EMPTY)
    setSaving(false)
  }

  function startEdit(idx: number) {
    setForm({ ...(savedAddresses[idx] as any) } || EMPTY)
    setEditIdx(idx)
    setEditing(true)
  }

  async function handleDelete(idx: number) {
    const updated = savedAddresses.filter((_, i) => i !== idx)
    try {
      await fetch('/api/v1/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_addresses', phone: user?.phone, saved_addresses: updated }),
      })
    } catch { /* local fallback */ }
    setAddresses(updated as any)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-bold text-stone-900">Saved Addresses</h1>
        {!editing && (
          <button onClick={() => { setForm(EMPTY); setEditIdx(null); setEditing(true) }}
            className="text-sm font-semibold text-forest-700 hover:text-forest-900 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            Add New
          </button>
        )}
      </div>

      {editing && (
        <div className="bg-white border border-stone-200 rounded-2xl p-5 mb-5">
          <h2 className="text-sm font-bold text-stone-800 mb-4">{editIdx !== null ? 'Edit Address' : 'New Address'}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-stone-600 mb-1">Flat / House</label>
              <input type="text" value={form.flat} onChange={e => setField('flat', e.target.value)} placeholder="A-12, Green Apartments"
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-forest-500" />
            </div>
            {[
              { field: 'area', label: 'Area / Colony', placeholder: 'Sector 15' },
              { field: 'city', label: 'City', placeholder: 'Dehradun' },
              { field: 'pincode', label: 'Pincode', placeholder: '248001' },
            ].map(({ field, label, placeholder }) => (
              <div key={field}>
                <label className="block text-xs font-semibold text-stone-600 mb-1">{label}</label>
                <input type={field === 'pincode' ? 'number' : 'text'} value={(form as any)[field]}
                  onChange={e => setField(field, e.target.value)} placeholder={placeholder} maxLength={field === 'pincode' ? 6 : 200}
                  className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-forest-500" />
              </div>
            ))}
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1">State</label>
              <select value={form.state} onChange={e => setField('state', e.target.value)}
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-forest-500 bg-white">
                {INDIA_STATES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-stone-600 mb-2">Label</label>
              <div className="flex gap-2 flex-wrap">
                {LABELS.map(l => (
                  <button key={l} onClick={() => setField('label', l)} type="button"
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${form.label === l ? 'border-forest-600 bg-forest-50 text-forest-700' : 'border-stone-200 text-stone-500 hover:border-forest-300'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={handleSave} disabled={saving}
              className="flex-1 bg-forest-700 hover:bg-forest-800 text-white font-bold py-2.5 rounded-xl text-sm disabled:opacity-60 transition-colors">
              {saving ? 'Saving…' : 'Save Address'}
            </button>
            <button onClick={() => { setEditing(false); setEditIdx(null) }}
              className="px-5 py-2.5 border border-stone-200 text-stone-600 rounded-xl text-sm hover:bg-stone-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {savedAddresses.length === 0 && !editing ? (
        <div className="text-center py-12 border border-dashed border-stone-200 rounded-2xl">
          <div className="text-3xl mb-3">📍</div>
          <p className="text-stone-400 text-sm mb-3">No saved addresses yet</p>
          <button onClick={() => { setForm(EMPTY); setEditIdx(null); setEditing(true) }}
            className="text-forest-700 text-sm font-semibold hover:underline">Add your first address</button>
        </div>
      ) : (
        <div className="space-y-3">
          {savedAddresses.map((addr: any, i) => (
            <div key={i} className="bg-white border border-stone-200 rounded-xl p-4 flex items-start justify-between gap-4">
              <div>
                <span className="text-xs font-bold text-forest-700 bg-forest-50 px-2 py-0.5 rounded-full inline-block mb-1">
                  {addr.label || 'Home'}
                </span>
                <div className="text-sm text-stone-700">{addr.flat}, {addr.area}</div>
                <div className="text-sm text-stone-500">{addr.city}, {addr.state} — {addr.pincode}</div>
              </div>
              <div className="flex gap-3 shrink-0">
                <button onClick={() => startEdit(i)} className="text-xs font-semibold text-stone-500 hover:text-forest-700 transition-colors">Edit</button>
                <button onClick={() => handleDelete(i)} className="text-xs font-semibold text-stone-500 hover:text-red-500 transition-colors">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
