'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useUserStore } from '@/store/userStore'
import { formatPrice } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────
type Tab = 'orders' | 'addresses' | 'profile' | 'password'
type OrderStatus = string

const INDIA_STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Andaman & Nicobar Islands','Chandigarh','Dadra & Nagar Haveli and Daman & Diu','Delhi','Jammu & Kashmir','Ladakh','Lakshadweep','Puducherry']

const BADGE_CLASS: Record<string, string> = {
  pending:'badge-pending', confirmed:'badge-confirmed', processing:'badge-confirmed',
  packed:'badge-packed', shipped:'badge-shipped', delivered:'badge-delivered',
  cancelled:'badge-cancelled', returned:'badge-returned',
  return_requested:'badge-return_requested', return_approved:'badge-return_approved',
  return_received:'badge-return_received', refunded:'badge-refunded',
  refund_initiated:'badge-refund_initiated', refund_completed:'badge-refund_completed',
  return_rejected:'badge-return_rejected',
}
const STATUS_LABEL: Record<string, string> = {
  pending:'Pending', confirmed:'Confirmed', processing:'Processing',
  packed:'Packed', shipped:'Shipped', delivered:'Delivered',
  cancelled:'Cancelled', returned:'Returned',
  return_requested:'Return Requested', return_approved:'Return Approved',
  return_received:'Item Received', refunded:'Refund Issued',
  refund_initiated:'Refund Initiated', refund_completed:'Refund Credited',
  return_rejected:'Return Rejected',
}
const STRIPE_CLASS: Record<string, string> = {
  confirmed:'oc-stripe-confirmed', packed:'oc-stripe-packed', shipped:'oc-stripe-shipped',
  delivered:'oc-stripe-delivered', pending:'oc-stripe-pending', cancelled:'oc-stripe-cancelled',
  processing:'oc-stripe-processing', returned:'oc-stripe-returned',
  return_requested:'oc-stripe-return_requested', return_approved:'oc-stripe-return_approved',
  return_received:'oc-stripe-return_received', refunded:'oc-stripe-refunded',
  refund_initiated:'oc-stripe-refund_initiated', refund_completed:'oc-stripe-refund_completed',
  return_rejected:'oc-stripe-return_rejected',
}
const LABEL_ICONS: Record<string, string> = { Home:'🏠', Office:'🏢', Parents:'👨‍👩‍👦', Friends:'👫', Others:'📍' }

function getToken() { try { return localStorage.getItem('pr_auth_token') } catch { return null } }
function getRefresh() { try { return localStorage.getItem('pr_auth_refresh') } catch { return null } }
function saveToken(t: string) { try { localStorage.setItem('pr_auth_token', t) } catch {} }
function saveRefresh(t: string) { try { localStorage.setItem('pr_auth_refresh', t) } catch {} }
function getProfile() { try { return JSON.parse(localStorage.getItem('pr_auth_profile') || 'null') } catch { return null } }
function saveProfile(p: any) { try { localStorage.setItem('pr_auth_profile', JSON.stringify(p)) } catch {} }
function getSavedAddresses(profile: any) {
  try { return JSON.parse(profile?.saved_addresses || localStorage.getItem('pr_saved_addresses') || '[]') } catch { return [] }
}

async function callAuth(action: string, body: any = {}, token?: string | null) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = 'Bearer ' + token
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 10000)
  try {
    const res  = await fetch('/api/auth', { method: 'POST', headers, body: JSON.stringify({ action, ...body }), signal: ctrl.signal })
    clearTimeout(t)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error ' + res.status)
    return data
  } catch (e) { clearTimeout(t); throw e }
}

export default function AccountPage() {
  const router = useRouter()
  const [tab, setTab]           = useState<Tab>('orders')
  const [loaded, setLoaded]     = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [profile, setProfile]   = useState<any>(null)
  const [authUser, setAuthUser] = useState<any>(null)
  const [orders,   setOrders]   = useState<any[] | null>(null)
  const [orderFilter, setOrderFilter] = useState('all')
  const [orderSearch, setOrderSearch] = useState('')
  const [toast, setToast]       = useState('')
  const [token, setToken]       = useState<string | null>(null)

  // Profile form state
  const [pf, setPf] = useState({ fname: '', lname: '', addr: '', city: '', state: '', pin: '', phone: '' })
  // Password form
  const [pw, setPw] = useState({ newp: '', conf: '' })
  const [saveMsg, setSaveMsg] = useState<Record<string, string>>({})

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  const doInit = useCallback(async () => {
    const tk = getToken()
    const cached = getProfile()
    if (!tk) { setLoaded(true); setLoggedIn(false); return }

    // Show cached profile immediately
    if (cached) {
      setProfile(cached)
      setLoggedIn(true)
      setPfFromProfile(cached)
      setToken(tk)
      setLoaded(true)
      fetchOrders(tk)
      // Background refresh profile
      refreshProfile(tk)
      return
    }

    // Cold load
    try {
      const data = await callAuth('get_profile', {}, tk)
      if (!data.profile) { setLoaded(true); setLoggedIn(false); return }
      setProfile(data.profile); setAuthUser(data.user); saveProfile(data.profile)
      setPfFromProfile(data.profile)
      setLoggedIn(true); setToken(tk); setLoaded(true)
      fetchOrders(tk)
    } catch {
      // Try refresh
      const rt = getRefresh()
      if (rt) {
        try {
          const r = await callAuth('refresh_token', { refresh_token: rt })
          if (r.access_token) {
            saveToken(r.access_token)
            if (r.refresh_token) saveRefresh(r.refresh_token)
            const data = await callAuth('get_profile', {}, r.access_token)
            setProfile(data.profile); saveProfile(data.profile)
            setPfFromProfile(data.profile)
            setAuthUser(data.user); setLoggedIn(true); setToken(r.access_token)
            setLoaded(true); fetchOrders(r.access_token); return
          }
        } catch {}
      }
      setLoaded(true); setLoggedIn(false)
    }
  }, [])

  async function refreshProfile(tk: string) {
    try {
      const data = await callAuth('get_profile', {}, tk)
      if (data.profile) { setProfile(data.profile); saveProfile(data.profile); setPfFromProfile(data.profile) }
    } catch {}
  }

  async function fetchOrders(tk: string) {
    try {
      const data = await callAuth('get_orders', {}, tk)
      setOrders(data.orders || [])
    } catch {
      const rt = getRefresh()
      if (rt) {
        try {
          const r = await callAuth('refresh_token', { refresh_token: rt })
          if (r.access_token) {
            saveToken(r.access_token); setToken(r.access_token)
            if (r.refresh_token) saveRefresh(r.refresh_token)
            const data = await callAuth('get_orders', {}, r.access_token)
            setOrders(data.orders || [])
          }
        } catch {}
      }
    }
  }

  function setPfFromProfile(p: any) {
    if (!p) return
    setPf({
      fname: p.first_name || '', lname: p.last_name || '',
      addr: p.address_line1 || '', city: p.city || '',
      state: p.state || '', pin: p.postal_code || '',
      phone: (p.phone || '').replace(/^\+91/, ''),
    })
  }

  useEffect(() => { doInit() }, [doInit])

  async function doLogout() {
    try { await callAuth('logout', {}, token) } catch {}
    try { ['pr_auth_token','pr_auth_user','pr_auth_profile','pr_auth_refresh'].forEach(k => localStorage.removeItem(k)) } catch {}
    router.push('/')
  }

  function switchTab(t: Tab) {
    setTab(t)
    if (t === 'orders' && !orders && token) fetchOrders(token)
  }

  // ── Profile saves
  async function saveProfileInfo() {
    try {
      const up = { first_name: pf.fname, last_name: pf.lname }
      await callAuth('update_profile', up, token)
      const np = { ...profile, ...up }; setProfile(np); saveProfile(np)
      setSaveMsg(m => ({ ...m, name: '✅ Saved!' }))
      setTimeout(() => setSaveMsg(m => ({ ...m, name: '' })), 2500)
    } catch (e: any) { showToast('❌ ' + e.message) }
  }
  async function saveAddrInfo() {
    try {
      const up = { address_line1: pf.addr, city: pf.city, state: pf.state, postal_code: pf.pin }
      await callAuth('update_profile', up, token)
      const np = { ...profile, ...up }; setProfile(np); saveProfile(np)
      setSaveMsg(m => ({ ...m, addr: '✅ Address saved!' }))
      setTimeout(() => setSaveMsg(m => ({ ...m, addr: '' })), 2500)
    } catch (e: any) { showToast('❌ ' + e.message) }
  }
  async function savePhone() {
    if (pf.phone.length !== 10) { showToast('📱 Enter valid 10-digit phone'); return }
    try {
      await callAuth('update_profile', { phone: '+91' + pf.phone }, token)
      const np = { ...profile, phone: '+91' + pf.phone }; setProfile(np); saveProfile(np)
      setSaveMsg(m => ({ ...m, phone: '✅ Phone saved!' }))
      setTimeout(() => setSaveMsg(m => ({ ...m, phone: '' })), 2500)
    } catch (e: any) { showToast('❌ ' + e.message) }
  }
  async function changePassword() {
    if (pw.newp.length < 6) { showToast('❌ Min 6 characters'); return }
    if (pw.newp !== pw.conf) { showToast('❌ Passwords do not match'); return }
    try {
      await callAuth('change_password', { new_password: pw.newp }, token)
      setPw({ newp: '', conf: '' })
      showToast('✅ Password updated!')
    } catch (e: any) { showToast('❌ ' + e.message) }
  }

  // ── Addresses
  const savedAddrs = getSavedAddresses(profile)
  async function deleteAddr(idx: number) {
    const updated = savedAddrs.filter((_: any, i: number) => i !== idx)
    try {
      await callAuth('update_profile', { saved_addresses: JSON.stringify(updated) }, token)
      const np = { ...profile, saved_addresses: JSON.stringify(updated) }
      setProfile(np); saveProfile(np); showToast('Address removed')
    } catch { showToast('❌ Remove failed') }
  }

  // ── Render
  if (!loaded) return (
    <div className="acc-loading">
      <div className="acc-spinner" /><p>Loading your account...</p>
    </div>
  )

  if (!loggedIn) return (
    <div className="acc-login-wall">
      <div className="acc-lw-icon">🔐</div>
      <div className="acc-lw-title">Login Required</div>
      <p className="acc-lw-sub">Login to manage your orders, addresses and profile.</p>
      <Link href="/?login=1" className="acc-lw-btn">👤 Login / Sign Up</Link>
    </div>
  )

  const firstName  = profile?.first_name || authUser?.user_metadata?.full_name?.split(' ')[0] || 'User'
  const fullName   = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || firstName
  const email      = authUser?.email || profile?.email || ''
  const initials   = (firstName[0] || '?').toUpperCase()

  // Filter orders
  const ACTIVE   = ['pending','confirmed','processing','packed','shipped']
  const RETURNS  = ['return_requested','return_approved','return_received','refunded','refund_initiated','refund_completed','return_rejected','returned']
  const filteredOrders = (orders || []).filter(o => {
    const s = o._displayStatus || o.order_status || ''
    const matchF = orderFilter === 'all' ||
      (orderFilter === 'active'    && ACTIVE.includes(s)) ||
      (orderFilter === 'delivered' && s === 'delivered')  ||
      (orderFilter === 'returns'   && RETURNS.includes(s)) ||
      (orderFilter === 'cancelled' && s === 'cancelled')
    const q = orderSearch.toLowerCase().trim()
    const matchQ = !q || (o.order_number || '').toLowerCase().includes(q) ||
      (o.items || []).some((i: any) => (i.name || '').toLowerCase().includes(q))
    return matchF && matchQ
  })

  return (
    <div className="acc-page">

      {/* Sidebar */}
      <aside className="acc-sidebar">
        <div className="acc-sb-profile">
          <div className="acc-sb-avatar">{initials}</div>
          <div className="acc-sb-name">{fullName}</div>
          <div className="acc-sb-email">{email}</div>
        </div>
        <div className="acc-sb-nav">
          {([
            { key: 'orders',    icon: '📦', label: 'My Orders' },
            { key: 'addresses', icon: '📍', label: 'Addresses' },
            { key: 'profile',   icon: '👤', label: 'Profile' },
            { key: 'password',  icon: '🔒', label: 'Change Password' },
          ] as const).map(item => (
            <button
              key={item.key}
              className={`acc-sb-item${tab === item.key ? ' active' : ''}`}
              onClick={() => switchTab(item.key)}
            >
              <span className="acc-sb-icon">{item.icon}</span> {item.label}
            </button>
          ))}
          <div className="acc-sb-divider" />
          <button className="acc-sb-item acc-logout" onClick={doLogout}>
            <span className="acc-sb-icon">🚪</span> Logout
          </button>
        </div>
      </aside>

      {/* Main panel */}
      <div className="acc-main">

        {/* ── ORDERS ── */}
        {tab === 'orders' && (
          <div className="acc-card">
            <div className="acc-card-title">
              📦 My Orders
              {orders !== null && <span className="acc-count"> ({orders.length})</span>}
            </div>

            {orders === null ? (
              <div className="acc-loading"><div className="acc-spinner" /><p>Loading orders...</p></div>
            ) : (
              <>
                {/* Toolbar */}
                <div className="acc-orders-toolbar">
                  <input
                    className="acc-order-search"
                    type="text"
                    placeholder="🔍  Search by order number or product…"
                    value={orderSearch}
                    onChange={e => setOrderSearch(e.target.value)}
                  />
                  {['all','active','delivered','returns','cancelled'].map(f => (
                    <button
                      key={f}
                      className={`acc-filter-btn${orderFilter === f ? ' active' : ''}`}
                      onClick={() => setOrderFilter(f)}
                    >
                      {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>

                {filteredOrders.length === 0 ? (
                  <div className="acc-empty">
                    <div className="acc-empty-icon">📦</div>
                    <div className="acc-empty-title">{orders.length === 0 ? 'No orders yet' : 'No orders found'}</div>
                    <p className="acc-empty-sub">{orders.length === 0 ? 'Shop our Himalayan products!' : 'Try a different filter or search.'}</p>
                    {orders.length === 0 && <Link href="/products" className="acc-btn-primary">🛍️ Shop Now</Link>}
                  </div>
                ) : (
                  filteredOrders.map((o: any) => {
                    const ds      = o._displayStatus || o.order_status || 'pending'
                    const badge   = BADGE_CLASS[ds] || 'badge-pending'
                    const stripe  = STRIPE_CLASS[ds] || 'oc-stripe-pending'
                    const label   = STATUS_LABEL[ds] || ds
                    const date    = o.created_at ? new Date(o.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : ''
                    const items   = o.items || []
                    const trackUrl = o.tracking_number
                      ? `https://www.google.com/search?q=${o.courier || ''} tracking ${o.tracking_number}`
                      : ''

                    // Delivery status message
                    let statusMsg = ''
                    if (ds === 'delivered') statusMsg = '✅ Delivered! Enjoy your Himalayan goodness 🌿'
                    else if (ds === 'shipped' && o.shipped_at) {
                      const est = new Date(o.shipped_at); est.setDate(est.getDate() + 5)
                      statusMsg = `🚚 Shipped · Est. ${est.toLocaleDateString('en-IN',{day:'numeric',month:'short'})}`
                    }
                    else if (ds === 'return_requested') statusMsg = '⏳ Return under review · 24–48 hrs'
                    else if (ds === 'refund_completed') statusMsg = '💚 Refund credited to your account!'
                    else if (ds === 'cancelled') statusMsg = '❌ Order cancelled'

                    return (
                      <div key={o.id} className="oc-card">
                        <div className={`oc-stripe ${stripe}`} />
                        <div className="oc-inner">
                          {/* Header */}
                          <div className="oc-hdr">
                            <div className="oc-meta">
                              <div><div className="oc-meta-lbl">Order Placed</div><div className="oc-meta-val">{date}</div></div>
                              <div><div className="oc-meta-lbl">Total</div><div className="oc-meta-val oc-total">₹{(o.total_amount || 0).toLocaleString('en-IN')}</div></div>
                              {o.payment_method && <div><div className="oc-meta-lbl">Payment</div><div className="oc-meta-val">{o.payment_method === 'cod' ? '💵 COD' : '💳 Prepaid'}</div></div>}
                            </div>
                            <div className="oc-num-col">
                              <div className="oc-meta-lbl">Order #</div>
                              <div className="oc-order-num">{o.order_number || '#' + String(o.id).slice(0,8)}</div>
                              <span className={`oc-badge ${badge}`}>{label}</span>
                            </div>
                          </div>

                          {/* Images */}
                          {items.length > 0 && (
                            <div className="oc-imgs">
                              {items.slice(0,4).map((it: any, i: number) => (
                                <div key={i} className="oc-img-wrap">
                                  {it.image_url
                                    ? <img src={it.image_url} alt={it.name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '10px' }} />
                                    : <span style={{ fontSize: '28px' }}>{it.emoji || '🌿'}</span>}
                                </div>
                              ))}
                              {items.length > 4 && <div className="oc-img-more">+{items.length - 4}</div>}
                            </div>
                          )}

                          {/* Items text */}
                          <div className="oc-items-text">
                            {items.slice(0,3).map((i: any) => `${i.name || 'Product'} ×${i.qty || 1}`).join(', ')}
                            {items.length > 3 && ` & ${items.length - 3} more`}
                          </div>

                          {statusMsg && <div className="oc-status-msg">{statusMsg}</div>}

                          {trackUrl && (
                            <a href={trackUrl} target="_blank" rel="noopener noreferrer" className="oc-track-btn">
                              🚚 Track Shipment{o.tracking_number ? ' · ' + o.tracking_number : ''}
                            </a>
                          )}

                          <div className="oc-divider" />

                          {/* Actions */}
                          <div className="oc-actions">
                            <div className="oc-action-left">
                              <Link href={`/order-confirmation?id=${o.id}&num=${encodeURIComponent(o.order_number || '')}`} className="view-chip">📄 View Details</Link>
                              <Link href={`/order-confirmation?id=${o.id}&num=${encodeURIComponent(o.order_number || '')}&print=1`} className="view-chip" target="_blank">🧾 Invoice</Link>
                              {ds === 'delivered' && !RETURNS.includes(ds) && (
                                <button className="ret-btn" onClick={() => showToast('↩ Return request coming soon')}>↩ Return</button>
                              )}
                            </div>
                            <a href={`https://wa.me/919899984895?text=${encodeURIComponent('Hi, I need help with my order ' + (o.order_number || '') + '.')}`}
                              target="_blank" rel="noopener noreferrer" className="sup-btn">💬 Support</a>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </>
            )}
          </div>
        )}

        {/* ── ADDRESSES ── */}
        {tab === 'addresses' && (
          <div className="acc-card">
            <div className="acc-card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              📍 Delivery Addresses
              <button className="acc-btn-primary" style={{ fontSize: '13px', padding: '9px 18px' }}
                onClick={() => showToast('➕ Add address form — coming soon')}>+ Add Address</button>
            </div>
            {profile?.address_line1 && (
              <div className="acc-addr-card acc-addr-default">
                <div className="acc-addr-label">🏠 Home (Default)</div>
                <div className="acc-addr-line">
                  {[profile?.first_name, profile?.last_name].filter(Boolean).join(' ')}<br />
                  {[profile?.address_line1, profile?.city, profile?.state, profile?.postal_code].filter(Boolean).join(', ')}
                </div>
                <div className="acc-addr-actions">
                  <button className="acc-addr-btn" onClick={() => switchTab('profile')}>✏️ Edit</button>
                </div>
              </div>
            )}
            {savedAddrs.filter((a: any) => a.label !== 'Default').map((a: any, i: number) => (
              <div key={i} className="acc-addr-card">
                <div className="acc-addr-label">{LABEL_ICONS[a.label] || '📍'} {a.label}</div>
                <div className="acc-addr-line">
                  {a.name && <>{a.name}<br /></>}
                  {[a.addr || a.flat, a.city, a.state, a.pin || a.pincode].filter(Boolean).join(', ')}
                </div>
                <div className="acc-addr-actions">
                  <button className="acc-addr-btn acc-addr-del" onClick={() => deleteAddr(i)}>🗑 Remove</button>
                </div>
              </div>
            ))}
            {!profile?.address_line1 && savedAddrs.length === 0 && (
              <div className="acc-empty">
                <div className="acc-empty-icon">📍</div>
                <div className="acc-empty-title">No addresses saved</div>
              </div>
            )}
          </div>
        )}

        {/* ── PROFILE ── */}
        {tab === 'profile' && (
          <>
            <div className="acc-card">
              <div className="acc-card-title">👤 Personal Info</div>
              <div className="acc-form-grid">
                <div>
                  <div className="acc-field-lbl">First Name</div>
                  <input className="acc-field-inp" value={pf.fname} onChange={e => setPf(p => ({ ...p, fname: e.target.value }))} placeholder="First name" />
                </div>
                <div>
                  <div className="acc-field-lbl">Last Name</div>
                  <input className="acc-field-inp" value={pf.lname} onChange={e => setPf(p => ({ ...p, lname: e.target.value }))} placeholder="Last name" />
                </div>
              </div>
              <button className="acc-btn-primary" onClick={saveProfileInfo}>💾 Save Name</button>
              {saveMsg.name && <div className="acc-save-msg">{saveMsg.name}</div>}
            </div>

            <div className="acc-card">
              <div className="acc-card-title">📍 Default Address</div>
              <div className="acc-form-grid">
                <div className="acc-form-full">
                  <div className="acc-field-lbl">Address</div>
                  <input className="acc-field-inp" value={pf.addr} onChange={e => setPf(p => ({ ...p, addr: e.target.value }))} placeholder="House/Street/Colony" />
                </div>
                <div>
                  <div className="acc-field-lbl">City</div>
                  <input className="acc-field-inp" value={pf.city} onChange={e => setPf(p => ({ ...p, city: e.target.value }))} placeholder="City" />
                </div>
                <div>
                  <div className="acc-field-lbl">State</div>
                  <select className="acc-field-inp" value={pf.state} onChange={e => setPf(p => ({ ...p, state: e.target.value }))}>
                    <option value="">Select State / UT</option>
                    {INDIA_STATES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <div className="acc-field-lbl">Pincode</div>
                  <input className="acc-field-inp" value={pf.pin} onChange={e => setPf(p => ({ ...p, pin: e.target.value }))} placeholder="110001" maxLength={6} />
                </div>
              </div>
              <button className="acc-btn-primary" onClick={saveAddrInfo}>💾 Save Address</button>
              {saveMsg.addr && <div className="acc-save-msg">{saveMsg.addr}</div>}
            </div>

            <div className="acc-card">
              <div className="acc-card-title">📱 Contact Info</div>
              <div className="acc-form-grid">
                <div>
                  <div className="acc-field-lbl">Phone Number</div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ padding: '10px 12px', background: '#f5f5f5', borderRadius: '10px', fontSize: '14px', fontWeight: 700, color: '#555' }}>+91</span>
                    <input className="acc-field-inp" style={{ flex: 1 }} value={pf.phone} onChange={e => setPf(p => ({ ...p, phone: e.target.value.replace(/\D/g, '') }))} placeholder="10-digit mobile" maxLength={10} type="tel" />
                  </div>
                </div>
                <div>
                  <div className="acc-field-lbl">Email</div>
                  <input className="acc-field-inp" value={email} disabled style={{ opacity: .6, cursor: 'not-allowed' }} />
                </div>
              </div>
              <button className="acc-btn-primary" onClick={savePhone}>💾 Save Phone</button>
              {saveMsg.phone && <div className="acc-save-msg">{saveMsg.phone}</div>}
            </div>
          </>
        )}

        {/* ── PASSWORD ── */}
        {tab === 'password' && (
          <div className="acc-card">
            <div className="acc-card-title">🔒 Change Password</div>
            <div className="acc-form-grid">
              <div className="acc-form-full">
                <div className="acc-field-lbl">New Password</div>
                <input className="acc-field-inp" type="password" value={pw.newp} onChange={e => setPw(p => ({ ...p, newp: e.target.value }))} placeholder="Minimum 6 characters" />
              </div>
              <div className="acc-form-full">
                <div className="acc-field-lbl">Confirm Password</div>
                <input className="acc-field-inp" type="password" value={pw.conf} onChange={e => setPw(p => ({ ...p, conf: e.target.value }))} placeholder="Repeat new password" />
              </div>
            </div>
            <button className="acc-btn-primary" onClick={changePassword}>🔒 Update Password</button>
          </div>
        )}

      </div>

      {/* Mobile bottom tabs */}
      <div className="acc-mob-tabs">
        {([
          { key: 'orders',    icon: '📦', label: 'Orders' },
          { key: 'addresses', icon: '📍', label: 'Addresses' },
          { key: 'profile',   icon: '👤', label: 'Profile' },
          { key: 'password',  icon: '🔒', label: 'Password' },
        ] as const).map(item => (
          <button key={item.key} className={`acc-mob-tab${tab === item.key ? ' active' : ''}`} onClick={() => switchTab(item.key)}>
            <span>{item.icon}</span>{item.label}
          </button>
        ))}
        <button className="acc-mob-tab" onClick={doLogout}><span>🚪</span>Logout</button>
      </div>

      {/* Toast */}
      {toast && <div className="acc-toast">{toast}</div>}

      <style>{`
        .acc-page{max-width:1100px;margin:0 auto;padding:28px 16px 60px;display:grid;grid-template-columns:280px 1fr;gap:28px;align-items:start;background:#f7f3ee;min-height:100vh}
        @media(max-width:768px){.acc-page{grid-template-columns:1fr;padding:0 0 80px}}

        /* Sidebar */
        .acc-sidebar{background:#fdfaf4;border-radius:18px;overflow:hidden;box-shadow:0 4px 24px rgba(26,58,30,.1);border:1px solid rgba(200,146,10,.25);position:sticky;top:76px}
        .acc-sb-profile{background:linear-gradient(135deg,#1a3a1e,#2d5233);padding:24px;text-align:center}
        .acc-sb-avatar{width:64px;height:64px;background:rgba(255,255,255,.2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-size:28px;font-weight:900;color:#fff;border:3px solid rgba(255,255,255,.3);margin:0 auto 12px}
        .acc-sb-name{font-family:'Playfair Display',serif;font-size:18px;font-weight:900;color:#fff;margin-bottom:3px}
        .acc-sb-email{font-size:12px;color:rgba(255,255,255,.65)}
        .acc-sb-nav{padding:8px 0}
        .acc-sb-item{display:flex;align-items:center;gap:12px;padding:13px 20px;cursor:pointer;transition:all .2s;border:none;background:none;width:100%;text-align:left;font-family:'Lato',sans-serif;font-size:14px;font-weight:700;color:#4a4a4a;border-left:3px solid transparent}
        .acc-sb-item:hover{background:rgba(200,146,10,.08);color:#1a3a1e}
        .acc-sb-item.active{background:rgba(26,58,30,.07);color:#1a3a1e;border-left-color:#1a3a1e}
        .acc-sb-icon{font-size:16px;width:20px;text-align:center}
        .acc-sb-divider{height:1px;background:rgba(200,146,10,.15);margin:8px 0}
        .acc-logout{color:#c0392b!important}
        .acc-logout:hover{background:#fdecea!important}

        /* Main */
        .acc-main{display:flex;flex-direction:column;gap:20px}
        .acc-card{background:#fdfaf4;border-radius:18px;padding:24px;box-shadow:0 4px 24px rgba(26,58,30,.09);border:1px solid rgba(200,146,10,.2)}
        .acc-card-title{font-family:'Playfair Display',serif;font-size:18px;font-weight:700;color:#1a3a1e;margin-bottom:20px}
        .acc-count{font-size:15px;font-weight:400;color:#7a7a7a;font-family:'Lato',sans-serif}

        /* Orders toolbar */
        .acc-orders-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:20px}
        .acc-order-search{flex:1;min-width:180px;padding:10px 16px;border:1.5px solid #e0e0e0;border-radius:24px;font-size:13px;font-family:'Lato',sans-serif;outline:none;transition:border-color .2s;background:#fafafa}
        .acc-order-search:focus{border-color:#1a3a1e;background:#fff}
        .acc-filter-btn{padding:9px 16px;border-radius:20px;border:1.5px solid #e0e0e0;background:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:'Lato',sans-serif;transition:all .2s;color:#555}
        .acc-filter-btn:hover,.acc-filter-btn.active{background:#1a3a1e;color:#fff;border-color:#1a3a1e}

        /* Order card */
        .oc-card{border:1px solid rgba(200,146,10,.18);border-radius:20px;margin-bottom:20px;overflow:hidden;background:#fdfaf4;box-shadow:0 4px 20px rgba(26,58,30,.08);transition:transform .2s,box-shadow .2s}
        .oc-card:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(26,58,30,.13)}
        .oc-stripe{height:5px;width:100%}
        .oc-stripe-confirmed{background:linear-gradient(90deg,#43a047,#66bb6a)}
        .oc-stripe-packed{background:linear-gradient(90deg,#1565c0,#42a5f5)}
        .oc-stripe-shipped{background:linear-gradient(90deg,#5e35b1,#9575cd)}
        .oc-stripe-delivered{background:linear-gradient(90deg,#2e7d32,#66bb6a)}
        .oc-stripe-pending{background:linear-gradient(90deg,#e65100,#ffa726)}
        .oc-stripe-cancelled{background:linear-gradient(90deg,#b71c1c,#ef5350)}
        .oc-stripe-processing{background:linear-gradient(90deg,#1a3a1e,#43a047)}
        .oc-stripe-returned,.oc-stripe-return_requested,.oc-stripe-return_approved,.oc-stripe-return_received,.oc-stripe-refunded,.oc-stripe-refund_initiated,.oc-stripe-refund_completed,.oc-stripe-return_rejected{background:linear-gradient(90deg,#7b1fa2,#ce93d8)}
        .oc-inner{padding:20px 24px}
        .oc-hdr{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;padding-bottom:14px;border-bottom:1px solid #f0f0f0;margin-bottom:14px}
        .oc-meta{display:flex;gap:24px;flex-wrap:wrap}
        .oc-meta-lbl{font-size:10px;font-weight:800;color:#888;text-transform:uppercase;letter-spacing:.6px;margin-bottom:2px}
        .oc-meta-val{font-size:13px;font-weight:700;color:#1a1a1a}
        .oc-total{font-size:15px;font-weight:900;color:#1a3a1e}
        .oc-num-col{text-align:right}
        .oc-order-num{font-size:12px;font-weight:800;color:#1a3a1e;font-family:monospace;margin-bottom:4px}
        .oc-badge{display:inline-block;padding:5px 16px;border-radius:20px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px}
        .badge-confirmed,.badge-processing{background:linear-gradient(135deg,#e8f5e9,#c8e6c9);color:#1b5e20;border:1px solid #a5d6a7}
        .badge-packed{background:linear-gradient(135deg,#e3f2fd,#bbdefb);color:#0d47a1;border:1px solid #90caf9}
        .badge-shipped{background:linear-gradient(135deg,#ede7f6,#d1c4e9);color:#4527a0;border:1px solid #b39ddb}
        .badge-delivered{background:linear-gradient(135deg,#e8f5e9,#a5d6a7);color:#1b5e20;border:1px solid #81c784}
        .badge-pending{background:linear-gradient(135deg,#fff8e1,#ffecb3);color:#e65100;border:1px solid #ffd54f}
        .badge-cancelled{background:linear-gradient(135deg,#fdecea,#ffcdd2);color:#b71c1c;border:1px solid #ef9a9a}
        .badge-returned,.badge-return_requested,.badge-return_approved,.badge-return_received,.badge-refunded,.badge-refund_initiated,.badge-refund_completed,.badge-return_rejected{background:linear-gradient(135deg,#fce4ec,#f8bbd0);color:#c62828;border:1px solid #f48fb1}
        .oc-imgs{display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap}
        .oc-img-wrap{width:72px;height:72px;border-radius:10px;border:1.5px solid #eee;overflow:hidden;background:linear-gradient(135deg,#f5f0e8,#e8e0d0);display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .oc-img-more{width:72px;height:72px;border-radius:10px;background:#f5f5f5;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#7a7a7a;border:1.5px solid #eee}
        .oc-items-text{font-size:13px;color:#3a3a3a;margin-bottom:10px;line-height:1.6;font-weight:500}
        .oc-status-msg{font-size:12px;font-weight:700;color:#2e7d32;margin-bottom:10px}
        .oc-track-btn{display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#e8f5e9,#c8e6c9);color:#1b5e20;border:1.5px solid #a5d6a7;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:800;text-decoration:none;margin-bottom:10px}
        .oc-divider{border-top:1px solid #f0f0f0;margin:12px 0}
        .oc-actions{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
        .oc-action-left{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
        .view-chip{display:inline-flex;align-items:center;gap:4px;background:#f0f7f4;color:#1a3a1e;border:1.5px solid #c8e6c9;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:800;text-decoration:none;transition:all .2s}
        .view-chip:hover{background:#1a3a1e;color:#fff}
        .ret-btn{display:inline-flex;align-items:center;gap:4px;background:#fff5f5;color:#c0392b;border:1.5px solid #fdecea;padding:6px 16px;border-radius:20px;font-size:12px;font-weight:800;cursor:pointer;font-family:'Lato',sans-serif}
        .ret-btn:hover{background:#c0392b;color:#fff}
        .sup-btn{display:inline-flex;align-items:center;gap:6px;background:#fff;color:#1a7a3a;border:1.5px solid #c8e6c9;padding:7px 14px;border-radius:20px;font-size:12px;font-weight:800;text-decoration:none}
        .sup-btn:hover{background:#e8f5e9}

        /* Address cards */
        .acc-addr-card{border:1.5px solid #eeeeee;border-radius:14px;padding:14px 16px;margin-bottom:10px;transition:all .2s}
        .acc-addr-default{border-color:#c8e6c9;background:#f0f7f4}
        .acc-addr-label{display:flex;align-items:center;gap:6px;font-weight:800;font-size:13px;color:#1a3a1e;margin-bottom:4px}
        .acc-addr-line{font-size:13px;color:#4a4a4a;line-height:1.6}
        .acc-addr-actions{display:flex;gap:8px;margin-top:10px}
        .acc-addr-btn{padding:5px 12px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;border:1.5px solid #c8e6c9;color:#1a3a1e;background:#fff;font-family:'Lato',sans-serif;transition:all .2s}
        .acc-addr-btn:hover{background:#1a3a1e;color:#fff;border-color:#1a3a1e}
        .acc-addr-del{border-color:#fdecea;color:#c0392b}
        .acc-addr-del:hover{background:#fdecea;color:#c0392b;border-color:#fdecea}

        /* Form */
        .acc-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}
        .acc-form-full{grid-column:1/-1}
        .acc-field-lbl{font-size:11px;font-weight:800;color:#7a7a7a;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px}
        .acc-field-inp{width:100%;padding:11px 14px;border:1.5px solid #eeeeee;border-radius:10px;font-size:14px;font-family:'Lato',sans-serif;color:#1a1a1a;transition:border-color .2s;outline:none;background:#fff;box-sizing:border-box}
        .acc-field-inp:focus{border-color:#1a3a1e}
        .acc-field-inp:disabled{background:#f8f8f8;color:#7a7a7a}

        /* Buttons */
        .acc-btn-primary{background:linear-gradient(135deg,#1a3a1e,#2d5233);color:#fff;border:none;padding:12px 24px;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;font-family:'Lato',sans-serif;transition:all .2s;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
        .acc-btn-primary:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(26,58,30,.25)}
        .acc-save-msg{font-size:12px;color:#2d6a4f;margin-top:8px;font-weight:700}

        /* Empty */
        .acc-empty{text-align:center;padding:48px 20px}
        .acc-empty-icon{font-size:48px;margin-bottom:16px}
        .acc-empty-title{font-family:'Playfair Display',serif;font-size:20px;color:#1a3a1e;margin-bottom:8px;font-weight:700}
        .acc-empty-sub{font-size:14px;color:#7a7a7a;margin-bottom:24px}

        /* Login wall */
        .acc-login-wall{max-width:500px;margin:80px auto;background:#fff;border-radius:18px;padding:48px 32px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.06)}
        .acc-lw-icon{font-size:56px;margin-bottom:16px}
        .acc-lw-title{font-family:'Playfair Display',serif;font-size:26px;color:#1a3a1e;margin-bottom:8px;font-weight:900}
        .acc-lw-sub{font-size:14px;color:#7a7a7a;margin-bottom:28px;line-height:1.6}
        .acc-lw-btn{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#1a3a1e,#2d5233);color:#fff;padding:14px 28px;border-radius:12px;font-size:15px;font-weight:800;text-decoration:none}

        /* Loading */
        .acc-loading{text-align:center;padding:60px 20px;background:#f7f3ee;min-height:100vh}
        .acc-spinner{width:32px;height:32px;border:3px solid #eee;border-top-color:#1a3a1e;border-radius:50%;animation:acc-spin 1s linear infinite;margin:0 auto 12px}
        @keyframes acc-spin{to{transform:rotate(360deg)}}

        /* Mobile tabs */
        .acc-mob-tabs{display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #eee;z-index:100;box-shadow:0 -4px 16px rgba(0,0,0,.08)}
        .acc-mob-tab{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:10px 8px;border:none;background:none;cursor:pointer;font-family:'Lato',sans-serif;font-size:10px;font-weight:700;color:#aaa;gap:3px;transition:color .2s}
        .acc-mob-tab.active{color:#1a3a1e}
        .acc-mob-tab span{font-size:20px}
        @media(max-width:768px){.acc-sidebar{display:none}.acc-mob-tabs{display:flex}.acc-page{background:#f7f3ee}}

        /* Toast */
        .acc-toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a3a1e;color:#fff;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:700;z-index:9999;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.2)}
      `}</style>
    </div>
  )
}
