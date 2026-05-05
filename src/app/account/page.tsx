'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useUserStore } from '@/store/userStore'

type Tab = 'orders' | 'addresses' | 'profile' | 'password'

const INDIA_STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Andaman & Nicobar Islands','Chandigarh','Dadra & Nagar Haveli and Daman & Diu','Delhi','Jammu & Kashmir','Ladakh','Lakshadweep','Puducherry']

const BADGE_CLASS: Record<string,string> = {
  pending:'badge-pending',confirmed:'badge-confirmed',processing:'badge-confirmed',
  packed:'badge-packed',shipped:'badge-shipped',delivered:'badge-delivered',
  cancelled:'badge-cancelled',returned:'badge-returned',
  return_requested:'badge-return_requested',return_approved:'badge-return_approved',
  return_received:'badge-return_received',refunded:'badge-refunded',
  refund_initiated:'badge-refund_initiated',refund_completed:'badge-refund_completed',
  return_rejected:'badge-return_rejected',
}
const STATUS_LABEL: Record<string,string> = {
  pending:'Pending',confirmed:'Confirmed',processing:'Processing',
  packed:'Packed',shipped:'Shipped',delivered:'Delivered',
  cancelled:'Cancelled',returned:'Returned',
  return_requested:'Return Requested',return_approved:'Return Approved',
  return_received:'Item Received',refunded:'Refund Issued',
  refund_initiated:'Refund Initiated',refund_completed:'Refund Credited',
  return_rejected:'Return Rejected',
}
const STRIPE: Record<string,string> = {
  confirmed:'oc-stripe-confirmed',packed:'oc-stripe-packed',shipped:'oc-stripe-shipped',
  delivered:'oc-stripe-delivered',pending:'oc-stripe-pending',cancelled:'oc-stripe-cancelled',
  processing:'oc-stripe-processing',returned:'oc-stripe-returned',
  return_requested:'oc-stripe-return_requested',return_approved:'oc-stripe-return_approved',
  return_received:'oc-stripe-return_received',refunded:'oc-stripe-refunded',
  refund_initiated:'oc-stripe-refund_initiated',refund_completed:'oc-stripe-refund_completed',
  return_rejected:'oc-stripe-return_rejected',
}

// ── Validation ─────────────────────────────────────────────────────────
function isValidPhone(p: string) { return /^[6-9]\d{9}$/.test(p.replace(/\D/g,'')) }
function isValidPin(p: string)   { return /^\d{6}$/.test(p.trim()) }

// ── Storage helpers ────────────────────────────────────────────────────
const getToken    = () => { try { return localStorage.getItem('pr_auth_token')   } catch { return null } }
const getRefresh  = () => { try { return localStorage.getItem('pr_auth_refresh') } catch { return null } }
const saveToken   = (t: string) => { try { localStorage.setItem('pr_auth_token',   t) } catch {} }
const saveRefresh = (t: string) => { try { localStorage.setItem('pr_auth_refresh', t) } catch {} }
const getProfile  = () => { try { return JSON.parse(localStorage.getItem('pr_auth_profile') || 'null') } catch { return null } }
const saveProfile = (p: any)    => { try { localStorage.setItem('pr_auth_profile', JSON.stringify(p)) } catch {} }
const getSavedAddresses = (profile: any) => { try { return JSON.parse(profile?.saved_addresses || '[]') } catch { return [] } }

async function callAuth(action: string, body: any = {}, token?: string | null) {
  const headers: any = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = 'Bearer ' + token
  const ctrl = new AbortController()
  const tid = setTimeout(() => ctrl.abort(), 10000)
  try {
    const res  = await fetch('/api/auth', { method:'POST', headers, body: JSON.stringify({ action, ...body }), signal: ctrl.signal })
    clearTimeout(tid)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Error')
    return data
  } catch(e) { clearTimeout(tid); throw e }
}

export default function AccountPage() {
  const router      = useRouter()
  const storeLogout = useUserStore(s => s.logout)
  const storeSetUser = useUserStore(s => s.setUser)

  const initDone = useRef(false)
  const [tab,      setTab]      = useState<Tab>('orders')
  const [loaded,   setLoaded]   = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [profile,  setProfile]  = useState<any>(null)
  const [authUser, setAuthUser] = useState<any>(null)
  const [orders,   setOrders]   = useState<any[] | null>(null)
  const [filter,   setFilter]   = useState('all')
  const [search,   setSearch]   = useState('')
  const [toast,    setToast]    = useState('')
  const [toastType,setToastType]= useState<'success'|'error'>('success')
  const [token,    setToken]    = useState<string | null>(null)
  const [pf, setPf] = useState({ fname:'', lname:'', addr:'', city:'', state:'', pin:'', phone:'' })
  const [pfErr, setPfErr] = useState<Record<string,string>>({})
  const [pw,  setPw]  = useState({ newp:'', conf:'', showNew:false, showConf:false })
  const [msg, setMsg] = useState<Record<string,string>>({})
  const [busy, setBusy] = useState<Record<string,boolean>>({})
  const [mounted, setMounted] = useState(false)
  const [showAddAddr, setShowAddAddr] = useState(false)
  const [newAddr, setNewAddr] = useState({ label:'', name:'', flat:'', city:'', state:'', pin:'' })
  const [newAddrErr, setNewAddrErr] = useState<Record<string,string>>({})

  const toast$ = (m: string, type: 'success'|'error' = 'success') => { setToast(m); setToastType(type); setTimeout(() => setToast(''), 3000) }
  const setMsg$ = (k: string, v: string) => { setMsg(m => ({...m,[k]:v})); setTimeout(() => setMsg(m => ({...m,[k]:''})), 2500) }

  const doInit = useCallback(async () => {
    if (initDone.current) return
    initDone.current = true
    const tk = getToken(); const cached = getProfile()
    if (!tk) { setLoaded(true); setLoggedIn(false); return }
    if (cached) {
      setProfile(cached); setLoggedIn(true); pfFrom(cached); setToken(tk); setLoaded(true)
      storeSetUser({ id: cached.id||'', phone: (cached.phone||'').replace(/^\+91/,''), email: cached.email||'', name: cached.first_name||'' })
      fetchOrders(tk); refreshProf(tk); return
    }
    try {
      const d = await callAuth('get_profile', {}, tk)
      if (!d.profile) { setLoaded(true); setLoggedIn(false); return }
      setProfile(d.profile); setAuthUser(d.user); saveProfile(d.profile); pfFrom(d.profile)
      storeSetUser({ id: d.profile?.id||d.user?.id||'', phone: (d.profile?.phone||d.user?.phone||'').replace(/^\+91/,''), email: d.user?.email||d.profile?.email||'', name: d.profile?.first_name||'' })
      setLoggedIn(true); setToken(tk); setLoaded(true); fetchOrders(tk)
    } catch {
      const rt = getRefresh()
      if (rt) { try {
        const r = await callAuth('refresh_token', { refresh_token: rt })
        if (r.access_token) {
          saveToken(r.access_token); if (r.refresh_token) saveRefresh(r.refresh_token)
          const d = await callAuth('get_profile', {}, r.access_token)
          setProfile(d.profile); saveProfile(d.profile); pfFrom(d.profile)
          storeSetUser({ id: d.profile?.id||d.user?.id||'', phone: (d.profile?.phone||d.user?.phone||'').replace(/^\+91/,''), email: d.user?.email||d.profile?.email||'', name: d.profile?.first_name||'' })
          setAuthUser(d.user); setLoggedIn(true); setToken(r.access_token); setLoaded(true); fetchOrders(r.access_token); return
        }
      } catch {} }
      setLoaded(true); setLoggedIn(false)
    }
  }, [])

  async function refreshProf(tk: string) {
    try { const d = await callAuth('get_profile',{},tk); if(d.profile){setProfile(d.profile);saveProfile(d.profile);pfFrom(d.profile)} if(d.user) setAuthUser(d.user) } catch {}
  }
  async function fetchOrders(tk: string) {
    try { const d = await callAuth('get_orders',{},tk); setOrders(d.orders||[]) }
    catch { const rt = getRefresh(); if(rt) { try { const r = await callAuth('refresh_token',{refresh_token:rt}); if(r.access_token){saveToken(r.access_token);setToken(r.access_token);if(r.refresh_token)saveRefresh(r.refresh_token);const d=await callAuth('get_orders',{},r.access_token);setOrders(d.orders||[])} } catch {} } }
  }
  function pfFrom(p: any) {
    if (!p) return
    setPf({ fname:p.first_name||'', lname:p.last_name||'', addr:p.address_line1||'', city:p.city||'', state:p.state||'', pin:p.postal_code||'', phone:(p.phone||'').replace(/^\+91/,'') })
  }

  useEffect(() => { setMounted(true); doInit() }, [doInit])

  async function doLogout() {
    try { await callAuth('logout',{},token) } catch {}
    try { ['pr_auth_token','pr_auth_user','pr_auth_profile','pr_auth_refresh'].forEach(k=>localStorage.removeItem(k)) } catch {}
    storeLogout(); router.push('/')
  }

  // ── Profile saves ──────────────────────────────────────────────────────
  async function saveName() {
    const e: Record<string,string> = {}; if (!pf.fname.trim()) e.fname='First name required'
    if (Object.keys(e).length) { setPfErr(e); return } setPfErr({})
    setBusy(b=>({...b,name:true}))
    try { const up={first_name:pf.fname.trim(),last_name:pf.lname.trim()}; await callAuth('update_profile',up,token); const np={...profile,...up}; setProfile(np); saveProfile(np); setMsg$('name','✅ Name saved!') }
    catch(e:any) { toast$(e.message||'Failed to save','error') } finally { setBusy(b=>({...b,name:false})) }
  }
  async function saveAddr() {
    const e: Record<string,string> = {}
    if (!pf.addr.trim())  e.addr='Address required'
    if (!pf.city.trim())  e.city='City required'
    if (!pf.state)        e.state='Select a state'
    if (pf.pin && !isValidPin(pf.pin)) e.pin='Enter valid 6-digit pincode'
    if (Object.keys(e).length) { setPfErr(e); return } setPfErr({})
    setBusy(b=>({...b,addr:true}))
    try { const up={address_line1:pf.addr.trim(),city:pf.city.trim(),state:pf.state,postal_code:pf.pin}; await callAuth('update_profile',up,token); const np={...profile,...up}; setProfile(np); saveProfile(np); setMsg$('addr','✅ Address saved!') }
    catch(e:any) { toast$(e.message||'Failed to save','error') } finally { setBusy(b=>({...b,addr:false})) }
  }
  async function savePhone() {
    if (!isValidPhone(pf.phone)) { setPfErr(e=>({...e,phone:'Enter valid 10-digit mobile (starts with 6–9)'})); return }
    setPfErr(e=>({...e,phone:''})); setBusy(b=>({...b,phone:true}))
    try { await callAuth('update_profile',{phone:'+91'+pf.phone.replace(/\D/g,'')},token); const np={...profile,phone:'+91'+pf.phone}; setProfile(np); saveProfile(np); setMsg$('phone','✅ Phone saved!') }
    catch(e:any) { toast$(e.message||'Failed to save','error') } finally { setBusy(b=>({...b,phone:false})) }
  }
  async function changePassword() {
    const e: Record<string,string> = {}
    if (!pw.newp || pw.newp.length<6) e.newp='Minimum 6 characters'
    if (pw.newp !== pw.conf)          e.conf='Passwords do not match'
    if (Object.keys(e).length) { setPfErr(e); return } setPfErr({})
    setBusy(b=>({...b,pw:true}))
    try { await callAuth('change_password',{new_password:pw.newp},token); setPw({newp:'',conf:'',showNew:false,showConf:false}); toast$('✅ Password updated!') }
    catch(e:any) { toast$(e.message||'Failed to update password','error') } finally { setBusy(b=>({...b,pw:false})) }
  }


  async function saveNewAddr() {
    const e: Record<string,string> = {}
    if (!newAddr.label.trim()) e.label = 'Label required (e.g. Home, Office)'
    if (!newAddr.flat.trim())  e.flat  = 'Address line required'
    if (!newAddr.city.trim())  e.city  = 'City required'
    if (!newAddr.state)        e.state = 'State required'
    if (newAddr.pin && !isValidPin(newAddr.pin)) e.pin = 'Enter valid 6-digit pincode'
    if (Object.keys(e).length) { setNewAddrErr(e); return }
    setNewAddrErr({})
    setBusy(b=>({...b,newAddr:true}))
    try {
      const existing = getSavedAddresses(profile)
      const updated = [...existing, { label:newAddr.label.trim(), name:newAddr.name.trim(), addr:newAddr.flat.trim(), city:newAddr.city.trim(), state:newAddr.state, pin:newAddr.pin }]
      await callAuth('update_profile',{saved_addresses:JSON.stringify(updated)},token)
      const np={...profile,saved_addresses:JSON.stringify(updated)}
      setProfile(np); saveProfile(np)
      setNewAddr({ label:'', name:'', flat:'', city:'', state:'', pin:'' })
      setShowAddAddr(false)
      toast$('✅ Address saved!')
    } catch(e:any) { toast$(e.message||'Failed to save address','error') }
    finally { setBusy(b=>({...b,newAddr:false})) }
  }

  const savedAddrs = getSavedAddresses(profile)
  async function deleteAddr(addrLabel: string) {
    const all = getSavedAddresses(profile)
    const updated = all.filter((a:any) => a.label !== addrLabel)
    try { await callAuth('update_profile',{saved_addresses:JSON.stringify(updated)},token); const np={...profile,saved_addresses:JSON.stringify(updated)}; setProfile(np); saveProfile(np); toast$('Address removed') }
    catch { toast$('Failed to remove address','error') }
  }

  // ── Render: Loading ────────────────────────────────────────────────────
  if (!loaded) return (
    <div className="acc-loading">
      <div className="loading-inner">
        <div className="acc-spinner"/>
        <p className="loading-text">Loading your account…</p>
      </div>
    </div>
  )

  if (!loggedIn) return (
    <div className="acc-wrap" suppressHydrationWarning>
      <div className="login-wall">
        <div className="lw-icon">🔐</div>
        <div className="lw-title">Welcome Back</div>
        <p className="lw-sub">Please login to view your orders, manage addresses and update your profile.</p>
        <Link href="/?login=1" className="btn-primary">Sign In to Continue</Link>
      </div>
    </div>
  )

  const firstName = profile?.first_name || authUser?.user_metadata?.full_name?.split(' ')[0] || 'User'
  const fullName  = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || firstName
  const email     = authUser?.email  || profile?.email || ''
  const phone     = profile?.phone   || authUser?.phone || ''
  const initials  = (firstName[0]||'?').toUpperCase()

  const ACTIVE  = ['pending','confirmed','processing','packed','shipped']
  const RETURNS = ['return_requested','return_approved','return_received','refunded','refund_initiated','refund_completed','return_rejected','returned']
  
  // ── Order stats ────────────────────────────────────────────────────────
  const allOrders   = orders || []
  const totalOrders = allOrders.length
  const delivered   = allOrders.filter(o => (o._displayStatus||o.order_status)==='delivered').length
  const activeCount = allOrders.filter(o => ACTIVE.includes(o._displayStatus||o.order_status||'')).length
  const totalSpent  = allOrders.filter(o => (o._displayStatus||o.order_status)!=='cancelled').reduce((s:number,o:any)=>s+(o.total_amount||0),0)

  const filtered = allOrders.filter(o => {
    const s = o._displayStatus || o.order_status || ''
    const mF = filter==='all' || (filter==='active'&&ACTIVE.includes(s)) || (filter==='delivered'&&s==='delivered') || (filter==='returns'&&RETURNS.includes(s)) || (filter==='cancelled'&&s==='cancelled')
    const q  = search.toLowerCase().trim()
    const mQ = !q || (o.order_number||'').toLowerCase().includes(q) || (o.items||[]).some((i:any)=>(i.name||'').toLowerCase().includes(q))
    return mF && mQ
  })

  // ── Return eligibility: only within 7 days of delivery ────────────────
  function canReturn(o: any) {
    if ((o._displayStatus||o.order_status)!=='delivered') return false
    if (!o.delivered_at && !o.updated_at) return true // fallback: show if no date
    const deliveredDate = new Date(o.delivered_at||o.updated_at)
    const diffDays = (Date.now() - deliveredDate.getTime()) / (1000*60*60*24)
    return diffDays <= 7
  }

  return (
    <div className="acc-wrap">
      <div className="acc-page">

        {/* ── SIDEBAR ── */}
        <aside className="sidebar">
          <div className="sb-profile">
            <div className="sb-avatar-ring">
              <div className="sb-avatar">{initials}</div>
            </div>
            <div className="sb-name">{fullName}</div>
            {email  && <div className="sb-sub">{email}</div>}
            {!email && phone && <div className="sb-sub">{phone}</div>}
            {/* Member since */}
            {profile?.created_at && (
              <div className="sb-member">Member since {new Date(profile.created_at).toLocaleDateString('en-IN',{month:'short',year:'numeric'})}</div>
            )}
          </div>

          {/* Order quick stats */}
          {mounted && orders !== null && (
            <div className="sb-stats">
              <div className="sb-stat">
                <div className="sb-stat-val">{totalOrders}</div>
                <div className="sb-stat-lbl">Orders</div>
              </div>
              <div className="sb-stat-div"/>
              <div className="sb-stat">
                <div className="sb-stat-val">{delivered}</div>
                <div className="sb-stat-lbl">Delivered</div>
              </div>
              <div className="sb-stat-div"/>
              <div className="sb-stat">
                <div className="sb-stat-val">₹{totalSpent>=1000?(totalSpent/1000).toFixed(1)+'k':totalSpent}</div>
                <div className="sb-stat-lbl">Spent</div>
              </div>
            </div>
          )}

          <div className="sb-nav">
            {([
              {key:'orders'    as Tab, icon:'📦', label:'My Orders',       badge: activeCount>0?activeCount:null as number|null},
              {key:'addresses' as Tab, icon:'📍', label:'Addresses',       badge: null as number|null},
              {key:'profile'   as Tab, icon:'👤', label:'Profile',         badge: null as number|null},
              {key:'password'  as Tab, icon:'🔒', label:'Change Password', badge: null as number|null},
            ]).map(it => (
              <button key={it.key} className={`sb-item${tab===it.key?' active':''}`} onClick={()=>{setTab(it.key as Tab);if(it.key==='orders'&&!orders&&token)fetchOrders(token)}}>
                <span className="sb-icon">{it.icon}</span>
                <span className="sb-label">{it.label}</span>
                {it.badge && <span className="sb-badge">{it.badge}</span>}
              </button>
            ))}
            <div className="sb-div"/>
            <Link href="/wishlist" className="sb-item sb-wishlist">
              <span className="sb-icon">❤️</span>
              <span className="sb-label">Wishlist</span>
            </Link>
            <button className="sb-item sb-logout" onClick={doLogout}>
              <span className="sb-icon">🚪</span>
              <span className="sb-label">Logout</span>
            </button>
          </div>
        </aside>

        {/* ── MAIN PANEL ── */}
        <div className="main-panel">

          {/* ORDERS TAB */}
          {tab==='orders' && (
            <div className="panel-section">
              <div className="panel-header">
                <div className="panel-title">My Orders</div>
                {mounted && orders !== null && <div className="panel-count">{totalOrders} orders</div>}
              </div>

              {/* Order summary pills */}
              {mounted && orders !== null && totalOrders > 0 && (
                <div className="order-summary-strip">
                  <div className="oss-item oss-delivered">
                    <span className="oss-num">{delivered}</span>
                    <span className="oss-lbl">Delivered</span>
                  </div>
                  <div className="oss-item oss-active">
                    <span className="oss-num">{activeCount}</span>
                    <span className="oss-lbl">In Transit</span>
                  </div>
                  <div className="oss-item oss-cancelled">
                    <span className="oss-num">{allOrders.filter(o=>(o._displayStatus||o.order_status)==='cancelled').length}</span>
                    <span className="oss-lbl">Cancelled</span>
                  </div>
                  <div className="oss-item oss-spent">
                    <span className="oss-num">₹{totalSpent.toLocaleString('en-IN')}</span>
                    <span className="oss-lbl">Total Spent</span>
                  </div>
                </div>
              )}

              <div className="card">
                {orders===null ? (
                  <div className="loading-orders"><div className="acc-spinner"/><p>Fetching your orders…</p></div>
                ) : (
                  <>
                    <div className="orders-toolbar">
                      <div className="search-wrap">
                        <span className="search-icon">🔍</span>
                        <input className="orders-search" type="text" placeholder="Search by order # or product…" value={search} onChange={e=>setSearch(e.target.value)}/>
                        {search && <button className="search-clear" onClick={()=>setSearch('')}>✕</button>}
                      </div>
                      <div className="filter-row">
                        {[
                          {key:'all',label:'All'},
                          {key:'active',label:'Active'},
                          {key:'delivered',label:'Delivered'},
                          {key:'returns',label:'Returns'},
                          {key:'cancelled',label:'Cancelled'},
                        ].map(f=>(
                          <button key={f.key} className={`filter-btn${filter===f.key?' active':''}`} onClick={()=>setFilter(f.key)}>
                            {f.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {filtered.length===0 ? (
                      <div className="empty-state">
                        <div className="empty-icon">{orders.length===0?'🛍️':'🔍'}</div>
                        <div className="empty-title">{orders.length===0?'No orders yet':'Nothing found'}</div>
                        <p className="empty-sub">{orders.length===0?'Discover our Himalayan natural products.':'Try adjusting your search or filter.'}</p>
                        {orders.length===0 && <Link href="/products" className="btn-primary">Shop Now →</Link>}
                        {orders.length>0 && filter!=='all' && <button className="btn-secondary" onClick={()=>{setFilter('all');setSearch('')}}>Clear Filters</button>}
                      </div>
                    ) : filtered.map((o:any) => {
                      const ds     = o._displayStatus||o.order_status||'pending'
                      const badge  = BADGE_CLASS[ds]||'badge-pending'
                      const stripe = STRIPE[ds]||'oc-stripe-pending'
                      const label  = STATUS_LABEL[ds]||ds
                      const date   = o.created_at ? new Date(o.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : ''
                      const items  = o.items||[]
                      const trackUrl = o.tracking_number ? `https://www.google.com/search?q=${encodeURIComponent((o.courier||''))} tracking ${encodeURIComponent(o.tracking_number)}` : ''
                      let statusMsg = ''
                      if (ds==='delivered')             statusMsg = '✅ Delivered! Enjoy your Himalayan goodness 🌿'
                      else if (ds==='shipped'&&o.shipped_at) { const est=new Date(o.shipped_at);est.setDate(est.getDate()+5);statusMsg=`🚚 Shipped · Est. delivery by ${est.toLocaleDateString('en-IN',{day:'numeric',month:'short'})}` }
                      else if (ds==='packed')           statusMsg = '📦 Order packed, ready for dispatch'
                      else if (ds==='processing')       statusMsg = '⚙️ Processing your order'
                      else if (ds==='confirmed')        statusMsg = '✅ Order confirmed'
                      else if (ds==='return_requested') statusMsg = '⏳ Return request under review · 24–48 hrs'
                      else if (ds==='return_approved')  statusMsg = '✅ Return approved — pickup being arranged'
                      else if (ds==='refund_completed') statusMsg = '💚 Refund credited to your account!'
                      else if (ds==='cancelled')        statusMsg = '❌ Order cancelled'
                      return (
                        <div key={o.id} className="order-card">
                          <div className={`oc-stripe ${stripe}`}/>
                          <div className="oc-inner">
                            <div className="oc-hdr">
                              <div className="oc-hdr-left">
                                <div className="oc-num">{o.order_number||'#'+String(o.id).slice(0,8)}</div>
                                <div className="oc-date">{date}</div>
                              </div>
                              <div className="oc-hdr-right">
                                <span className={`oc-badge ${badge}`}>{label}</span>
                                <span className="oc-total">₹{(o.total_amount||0).toLocaleString('en-IN')}</span>
                                {o.payment_method && <span className="oc-pay">{o.payment_method==='cod'?'💵 COD':o.payment_method==='razorpay_online'?'💳 Online':o.payment_method==='razorpay'?'💳 Online':'💳 Prepaid'}</span>}
                              </div>
                            </div>

                            {items.length>0 && (
                              <div className="oc-items-row">
                                <div className="oc-imgs">
                                  {items.slice(0,4).map((it:any,i:number)=>(
                                    <div key={i} className="oc-img-box">
                                      {it.image_url ? <img src={it.image_url} alt={it.name||''} style={{width:'100%',height:'100%',objectFit:'cover'}}/> : <span style={{fontSize:'22px'}}>{it.emoji||'🌿'}</span>}
                                    </div>
                                  ))}
                                  {items.length>4 && <div className="oc-img-more">+{items.length-4}</div>}
                                </div>
                                <div className="oc-items-names">
                                  {items.slice(0,3).map((i:any)=>`${i.name||'Product'} ×${i.qty||1}`).join(' · ')}
                                  {items.length>3 && ` & ${items.length-3} more`}
                                </div>
                              </div>
                            )}

                            {statusMsg && <div className="oc-status-msg">{statusMsg}</div>}

                            {trackUrl && (
                              <a href={trackUrl} target="_blank" rel="noopener noreferrer" className="track-chip">
                                🚚 Track Shipment{o.tracking_number ? ` · ${o.tracking_number}` : ''}
                              </a>
                            )}

                            <div className="oc-actions">
                              <div className="oc-actions-left">
                                <Link href={`/account/orders/${o.id}`} className="action-btn action-view">View Details</Link>
                                <Link href={`/account/orders/${o.id}?print=1`} className="action-btn action-invoice" target="_blank">Invoice</Link>
                                {canReturn(o) && (
                                  <button className="action-btn action-return" onClick={()=>toast$('Please contact support to initiate a return')}>Return</button>
                                )}
                              </div>
                              <a href={`https://wa.me/919899984895?text=${encodeURIComponent('Hi, I need help with order '+(o.order_number||'')+'.')}`} target="_blank" rel="noopener noreferrer" className="action-btn action-support">💬 Support</a>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </>
                )}
              </div>
            </div>
          )}

          {/* ADDRESSES TAB */}
          {tab==='addresses' && (
            <div className="panel-section">
              <div className="panel-header">
                <div className="panel-title">Delivery Addresses</div>
              </div>
              <div className="card">
                {profile?.address_line1 && (
                  <div className="addr-card addr-default">
                    <div className="addr-header">
                      <div className="addr-label">🏠 Default Address</div>
                      <div className="addr-tag">Primary</div>
                    </div>
                    <div className="addr-line">
                      <strong>{[profile?.first_name,profile?.last_name].filter(Boolean).join(' ')}</strong><br/>
                      {[profile?.address_line1,profile?.city,profile?.state,profile?.postal_code].filter(Boolean).join(', ')}
                      {profile?.phone && <><br/><span style={{color:'#888'}}>{profile.phone}</span></>}
                    </div>
                    <div className="addr-actions">
                      <button className="addr-btn" onClick={()=>setTab('profile')}>✏️ Edit Address</button>
                    </div>
                  </div>
                )}

                {savedAddrs.filter((a:any)=>a.label!=='Default').map((a:any,i:number)=>(
                  <div key={i} className="addr-card">
                    <div className="addr-header">
                      <div className="addr-label">📍 {a.label||'Saved Address'}</div>
                    </div>
                    <div className="addr-line">
                      {a.name && <><strong>{a.name}</strong><br/></>}
                      {[a.addr||a.flat,a.city,a.state,a.pin||a.pincode].filter(Boolean).join(', ')}
                    </div>
                    <div className="addr-actions">
                      <button className="addr-btn addr-del" onClick={()=>deleteAddr(a.label)}>🗑 Remove</button>
                    </div>
                  </div>
                ))}

                {!profile?.address_line1 && savedAddrs.length===0 && !showAddAddr && (
                  <div className="empty-state">
                    <div className="empty-icon">📍</div>
                    <div className="empty-title">No addresses saved</div>
                    <p className="empty-sub">Add a delivery address to checkout faster.</p>
                  </div>
                )}

                {showAddAddr ? (
                  <div className="addr-add-form">
                    <div className="addr-add-title">Add New Address</div>
                    <div className="form-grid">
                      <div>
                        <div className="f-lbl">Label * (e.g. Home, Office)</div>
                        <input className={`f-inp${newAddrErr.label?' f-err':''}`} value={newAddr.label} onChange={e=>{setNewAddr(a=>({...a,label:e.target.value}));setNewAddrErr(er=>({...er,label:''}))}} placeholder="Home / Office / Parents"/>
                        {newAddrErr.label&&<div className="err-txt">{newAddrErr.label}</div>}
                      </div>
                      <div>
                        <div className="f-lbl">Contact Name</div>
                        <input className="f-inp" value={newAddr.name} onChange={e=>setNewAddr(a=>({...a,name:e.target.value}))} placeholder="Full name"/>
                      </div>
                      <div className="form-full">
                        <div className="f-lbl">Street / Flat / Colony *</div>
                        <input className={`f-inp${newAddrErr.flat?' f-err':''}`} value={newAddr.flat} onChange={e=>{setNewAddr(a=>({...a,flat:e.target.value}));setNewAddrErr(er=>({...er,flat:''}))}} placeholder="House no., Street, Colony"/>
                        {newAddrErr.flat&&<div className="err-txt">{newAddrErr.flat}</div>}
                      </div>
                      <div>
                        <div className="f-lbl">City *</div>
                        <input className={`f-inp${newAddrErr.city?' f-err':''}`} value={newAddr.city} onChange={e=>{setNewAddr(a=>({...a,city:e.target.value}));setNewAddrErr(er=>({...er,city:''}))}} placeholder="City"/>
                        {newAddrErr.city&&<div className="err-txt">{newAddrErr.city}</div>}
                      </div>
                      <div>
                        <div className="f-lbl">State *</div>
                        <select className={`f-inp${newAddrErr.state?' f-err':''}`} value={newAddr.state} onChange={e=>{setNewAddr(a=>({...a,state:e.target.value}));setNewAddrErr(er=>({...er,state:''}))}}>
                          <option value="">Select State / UT</option>
                          {INDIA_STATES.map(s=><option key={s}>{s}</option>)}
                        </select>
                        {newAddrErr.state&&<div className="err-txt">{newAddrErr.state}</div>}
                      </div>
                      <div>
                        <div className="f-lbl">Pincode</div>
                        <input className={`f-inp${newAddrErr.pin?' f-err':''}`} value={newAddr.pin} onChange={e=>{setNewAddr(a=>({...a,pin:e.target.value.replace(/\D/g,'')}));setNewAddrErr(er=>({...er,pin:''}))}} placeholder="110001" maxLength={6} inputMode="numeric"/>
                        {newAddrErr.pin&&<div className="err-txt">{newAddrErr.pin}</div>}
                      </div>
                    </div>
                    <div className="form-actions">
                      <button className="btn-primary" onClick={saveNewAddr} disabled={!!busy.newAddr}>{busy.newAddr?'Saving…':'Save Address'}</button>
                      <button className="btn-secondary" onClick={()=>{setShowAddAddr(false);setNewAddrErr({})}}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button className="add-addr-btn" onClick={()=>setShowAddAddr(true)}>
                    <span style={{fontSize:'18px',lineHeight:1}}>+</span> Add New Address
                  </button>
                )}
              </div>
            </div>
          )}

          {/* PROFILE TAB */}
          {tab==='profile' && (
            <div className="panel-section">
              <div className="panel-header">
                <div className="panel-title">My Profile</div>
              </div>

              <div className="card">
                <div className="card-section-title">Personal Information</div>
                <div className="form-grid">
                  <div>
                    <div className="f-lbl">First Name *</div>
                    <input className={`f-inp${pfErr.fname?' f-err':''}`} value={pf.fname} onChange={e=>{setPf(p=>({...p,fname:e.target.value}));setPfErr(er=>({...er,fname:''}))}} placeholder="First name"/>
                    {pfErr.fname && <div className="err-txt">{pfErr.fname}</div>}
                  </div>
                  <div>
                    <div className="f-lbl">Last Name</div>
                    <input className="f-inp" value={pf.lname} onChange={e=>setPf(p=>({...p,lname:e.target.value}))} placeholder="Last name"/>
                  </div>
                </div>
                <div className="form-actions">
                  <button className="btn-primary" onClick={saveName} disabled={!!busy.name}>{busy.name?'Saving…':'Save Name'}</button>
                  {msg.name && <div className="save-msg">{msg.name}</div>}
                </div>
              </div>

              <div className="card">
                <div className="card-section-title">Default Delivery Address</div>
                <div className="form-grid">
                  <div className="form-full">
                    <div className="f-lbl">Street / Flat / Colony *</div>
                    <input className={`f-inp${pfErr.addr?' f-err':''}`} value={pf.addr} onChange={e=>{setPf(p=>({...p,addr:e.target.value}));setPfErr(er=>({...er,addr:''}))}} placeholder="House no., Street, Colony"/>
                    {pfErr.addr && <div className="err-txt">{pfErr.addr}</div>}
                  </div>
                  <div>
                    <div className="f-lbl">City *</div>
                    <input className={`f-inp${pfErr.city?' f-err':''}`} value={pf.city} onChange={e=>{setPf(p=>({...p,city:e.target.value}));setPfErr(er=>({...er,city:''}))}} placeholder="City"/>
                    {pfErr.city && <div className="err-txt">{pfErr.city}</div>}
                  </div>
                  <div>
                    <div className="f-lbl">State *</div>
                    <select className={`f-inp${pfErr.state?' f-err':''}`} value={pf.state} onChange={e=>{setPf(p=>({...p,state:e.target.value}));setPfErr(er=>({...er,state:''}))}} >
                      <option value="">Select State / UT</option>
                      {INDIA_STATES.map(s=><option key={s}>{s}</option>)}
                    </select>
                    {pfErr.state && <div className="err-txt">{pfErr.state}</div>}
                  </div>
                  <div>
                    <div className="f-lbl">Pincode</div>
                    <input className={`f-inp${pfErr.pin?' f-err':''}`} value={pf.pin} onChange={e=>{setPf(p=>({...p,pin:e.target.value.replace(/\D/g,'')}));setPfErr(er=>({...er,pin:''}))}} placeholder="110001" maxLength={6} inputMode="numeric"/>
                    {pfErr.pin && <div className="err-txt">{pfErr.pin}</div>}
                  </div>
                </div>
                <div className="form-actions">
                  <button className="btn-primary" onClick={saveAddr} disabled={!!busy.addr}>{busy.addr?'Saving…':'Save Address'}</button>
                  {msg.addr && <div className="save-msg">{msg.addr}</div>}
                </div>
              </div>

              <div className="card">
                <div className="card-section-title">Contact Information</div>
                <div className="form-grid">
                  <div>
                    <div className="f-lbl">Phone Number</div>
                    <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
                      <span className="phone-prefix">+91</span>
                      <input className={`f-inp${pfErr.phone?' f-err':''}`} style={{flex:1}} value={pf.phone} onChange={e=>{setPf(p=>({...p,phone:e.target.value.replace(/\D/g,'')}));setPfErr(er=>({...er,phone:''}))}} placeholder="10-digit mobile" maxLength={10} inputMode="numeric"/>
                    </div>
                    {pfErr.phone && <div className="err-txt">{pfErr.phone}</div>}
                  </div>
                  <div>
                    <div className="f-lbl">Email Address</div>
                    <input className="f-inp f-disabled" value={email} disabled/>
                    <div className="f-hint">Email cannot be changed</div>
                  </div>
                </div>
                <div className="form-actions">
                  <button className="btn-primary" onClick={savePhone} disabled={!!busy.phone}>{busy.phone?'Saving…':'Save Phone'}</button>
                  {msg.phone && <div className="save-msg">{msg.phone}</div>}
                </div>
              </div>
            </div>
          )}

          {/* PASSWORD TAB */}
          {tab==='password' && (
            <div className="panel-section">
              <div className="panel-header">
                <div className="panel-title">Change Password</div>
              </div>
              <div className="card">
                <div className="card-section-title">Set New Password</div>
                <div className="form-grid" style={{maxWidth:'480px'}}>
                  <div className="form-full">
                    <div className="f-lbl">New Password *</div>
                    <div className="pw-wrap">
                      <input className={`f-inp${pfErr.newp?' f-err':''}`} type={pw.showNew?'text':'password'} value={pw.newp} onChange={e=>{setPw(p=>({...p,newp:e.target.value}));setPfErr(er=>({...er,newp:''}))}} placeholder="Minimum 6 characters"/>
                      <button type="button" className="pw-eye" onClick={()=>setPw(p=>({...p,showNew:!p.showNew}))}>{pw.showNew?'🙈':'👁'}</button>
                    </div>
                    {pfErr.newp && <div className="err-txt">{pfErr.newp}</div>}
                    {pw.newp.length>0 && (
                      <div className="pw-strength">
                        <div className={`pw-bar ${pw.newp.length>=8?'pw-strong':pw.newp.length>=6?'pw-medium':'pw-weak'}`}/>
                        <span className="pw-strength-lbl">{pw.newp.length>=8?'Strong':pw.newp.length>=6?'Medium':'Weak'}</span>
                      </div>
                    )}
                  </div>
                  <div className="form-full">
                    <div className="f-lbl">Confirm Password *</div>
                    <div className="pw-wrap">
                      <input className={`f-inp${pfErr.conf?' f-err':''}`} type={pw.showConf?'text':'password'} value={pw.conf} onChange={e=>{setPw(p=>({...p,conf:e.target.value}));setPfErr(er=>({...er,conf:''}))}} placeholder="Repeat new password"/>
                      <button type="button" className="pw-eye" onClick={()=>setPw(p=>({...p,showConf:!p.showConf}))}>{pw.showConf?'🙈':'👁'}</button>
                    </div>
                    {pfErr.conf && <div className="err-txt">{pfErr.conf}</div>}
                    {pw.conf.length>0 && pw.newp===pw.conf && <div className="match-msg">✅ Passwords match</div>}
                  </div>
                </div>
                <div className="form-actions">
                  <button className="btn-primary" onClick={changePassword} disabled={!!busy.pw}>{busy.pw?'Updating…':'Update Password'}</button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Mobile tabs */}
      <div className="mob-tabs">
        {([
          {key:'orders',icon:'📦',label:'Orders'},
          {key:'addresses',icon:'📍',label:'Addresses'},
          {key:'profile',icon:'👤',label:'Profile'},
          {key:'password',icon:'🔒',label:'Password'},
        ] as const).map(it=>(
          <button key={it.key} className={`mob-tab${tab===it.key?' active':''}`} onClick={()=>{setTab(it.key);if(it.key==='orders'&&!orders&&token)fetchOrders(token)}}>
            <span className="mt-icon">{it.icon}</span>{it.label}
          </button>
        ))}
        <button className="mob-tab" onClick={doLogout}><span className="mt-icon">🚪</span>Logout</button>
      </div>

      {toast && <div className={`acc-toast ${toastType==='error'?'acc-toast-error':''}`}>{toast}</div>}

      <style>{`
        *, *::before, *::after { box-sizing: border-box; }

        /* ── Wrap & Layout ── */
        .acc-wrap { background: #f4f0eb; min-height: 100vh; padding: 32px 24px 100px; }
        .acc-page { max-width: 1180px; margin: 0 auto; display: grid; grid-template-columns: 270px 1fr; gap: 28px; align-items: start; }
        @media(max-width: 900px) { .acc-page { grid-template-columns: 1fr; } .acc-wrap { padding: 16px 14px 90px; } }

        /* ── Sidebar ── */
        .sidebar { background: #fff; border-radius: 20px; overflow: hidden; box-shadow: 0 2px 24px rgba(26,58,30,.1); border: 1px solid rgba(200,146,10,.18); position: sticky; top: 80px; }
        .sb-profile { background: linear-gradient(160deg, #1a3a1e 0%, #2d5233 60%, #3a6b40 100%); padding: 28px 20px 20px; text-align: center; position: relative; }
        .sb-profile::after { content: ''; position: absolute; bottom: -1px; left: 0; right: 0; height: 20px; background: #fff; border-radius: 20px 20px 0 0; }
        .sb-avatar-ring { width: 72px; height: 72px; border-radius: 50%; padding: 3px; background: linear-gradient(135deg, rgba(255,255,255,.5), rgba(255,255,255,.1)); margin: 0 auto 12px; }
        .sb-avatar { width: 100%; height: 100%; background: rgba(255,255,255,.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-family: 'Playfair Display', serif; font-size: 30px; font-weight: 900; color: #fff; }
        .sb-name { font-family: 'Playfair Display', serif; font-size: 17px; font-weight: 700; color: #fff; margin-bottom: 4px; }
        .sb-sub { font-size: 12px; color: rgba(255,255,255,.6); font-family: var(--font-dm-sans, 'DM Sans', sans-serif); word-break: break-all; }
        .sb-member { font-size: 11px; color: rgba(255,255,255,.4); margin-top: 6px; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); }

        /* Sidebar stats */
        .sb-stats { display: flex; align-items: center; justify-content: space-around; padding: 14px 12px; border-bottom: 1px solid #f0ece6; margin-top: -4px; }
        .sb-stat { text-align: center; flex: 1; }
        .sb-stat-val { font-family: 'Playfair Display', serif; font-size: 18px; font-weight: 700; color: #1a3a1e; }
        .sb-stat-lbl { font-size: 10px; font-weight: 600; color: #aaa; text-transform: uppercase; letter-spacing: .4px; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); margin-top: 2px; }
        .sb-stat-div { width: 1px; height: 32px; background: #eee; }

        /* Sidebar nav */
        .sb-nav { padding: 6px 0 8px; }
        .sb-item { display: flex; align-items: center; gap: 11px; padding: 12px 20px; cursor: pointer; transition: all .2s; border: none; background: none; width: 100%; text-align: left; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); font-size: 14px; font-weight: 600; color: #555; border-left: 3px solid transparent; position: relative; text-decoration: none; }
        .sb-item:hover { background: rgba(26,58,30,.05); color: #1a3a1e; }
        .sb-item.active { background: linear-gradient(90deg, rgba(26,58,30,.08), transparent); color: #1a3a1e; border-left-color: #1a3a1e; }
        .sb-icon { font-size: 15px; width: 20px; text-align: center; flex-shrink: 0; }
        .sb-label { flex: 1; }
        .sb-badge { background: #e8f5e9; color: #1b5e20; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 10px; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); }
        .sb-div { height: 1px; background: #f0ece6; margin: 6px 0; }
        .sb-wishlist { color: #c0392b; }
        .sb-wishlist:hover { background: rgba(192,57,43,.05); color: #c0392b; }
        .sb-logout { color: #c0392b; }
        .sb-logout:hover { background: #fdecea; color: #c0392b; }
        @media(max-width: 900px) { .sidebar { display: none; } }

        /* ── Main Panel ── */
        .main-panel { display: flex; flex-direction: column; gap: 0; }
        .panel-section { display: flex; flex-direction: column; gap: 16px; }
        .panel-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 4px; }
        .panel-title { font-family: 'Playfair Display', serif; font-size: 24px; font-weight: 700; color: #1a3a1e; }
        .panel-count { font-size: 14px; color: #aaa; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); font-weight: 500; }

        /* Order summary strip */
        .order-summary-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        @media(max-width: 600px) { .order-summary-strip { grid-template-columns: repeat(2, 1fr); } }
        .oss-item { background: #fff; border-radius: 14px; padding: 14px 16px; border: 1px solid #ede9e3; display: flex; flex-direction: column; gap: 4px; }
        .oss-num { font-family: 'Playfair Display', serif; font-size: 22px; font-weight: 700; }
        .oss-lbl { font-size: 11px; font-weight: 600; color: #aaa; text-transform: uppercase; letter-spacing: .4px; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); }
        .oss-delivered .oss-num { color: #2e7d32; }
        .oss-active .oss-num { color: #5e35b1; }
        .oss-cancelled .oss-num { color: #c0392b; }
        .oss-spent .oss-num { color: #1a3a1e; }

        /* Card */
        .card { background: #fff; border-radius: 20px; padding: 28px; box-shadow: 0 2px 20px rgba(26,58,30,.07); border: 1px solid #ede9e3; }
        .card-section-title { font-family: var(--font-dm-sans, 'DM Sans', sans-serif); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .8px; color: #b8a882; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid #f5f0e8; }

        /* Orders toolbar */
        .orders-toolbar { display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
        .search-wrap { position: relative; display: flex; align-items: center; }
        .search-icon { position: absolute; left: 14px; font-size: 14px; }
        .orders-search { width: 100%; padding: 11px 40px 11px 40px; border: 1.5px solid #e8e3db; border-radius: 12px; font-size: 14px; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); outline: none; transition: border-color .2s; background: #fafaf8; color: #1a1a1a; }
        .orders-search:focus { border-color: #1a3a1e; background: #fff; }
        .orders-search::placeholder { color: #bbb; }
        .search-clear { position: absolute; right: 12px; background: none; border: none; cursor: pointer; font-size: 13px; color: #aaa; padding: 4px; }
        .search-clear:hover { color: #555; }
        .filter-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .filter-btn { padding: 8px 16px; border-radius: 10px; border: 1.5px solid #e8e3db; background: #fff; font-size: 12px; font-weight: 600; cursor: pointer; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); transition: all .2s; color: #666; }
        .filter-btn:hover { border-color: #1a3a1e; color: #1a3a1e; }
        .filter-btn.active { background: #1a3a1e; color: #fff; border-color: #1a3a1e; }

        /* Order card */
        .order-card { border: 1px solid #ede9e3; border-radius: 16px; margin-bottom: 16px; overflow: hidden; background: #fdfcfa; transition: box-shadow .25s, transform .2s; }
        .order-card:hover { box-shadow: 0 6px 28px rgba(26,58,30,.12); transform: translateY(-1px); }
        .oc-stripe { height: 4px; }
        .oc-stripe-confirmed { background: linear-gradient(90deg,#43a047,#66bb6a); }
        .oc-stripe-packed { background: linear-gradient(90deg,#1565c0,#42a5f5); }
        .oc-stripe-shipped { background: linear-gradient(90deg,#5e35b1,#9575cd); }
        .oc-stripe-delivered { background: linear-gradient(90deg,#2e7d32,#66bb6a); }
        .oc-stripe-pending { background: linear-gradient(90deg,#e65100,#ffa726); }
        .oc-stripe-cancelled { background: linear-gradient(90deg,#b71c1c,#ef5350); }
        .oc-stripe-processing { background: linear-gradient(90deg,#1a3a1e,#43a047); }
        .oc-stripe-returned,.oc-stripe-return_requested,.oc-stripe-return_approved,.oc-stripe-return_received,.oc-stripe-refunded,.oc-stripe-refund_initiated,.oc-stripe-refund_completed,.oc-stripe-return_rejected { background: linear-gradient(90deg,#7b1fa2,#ce93d8); }
        .oc-inner { padding: 20px 24px; }
        .oc-hdr { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px; padding-bottom: 14px; border-bottom: 1px solid #f0ece6; margin-bottom: 14px; }
        .oc-hdr-left {}
        .oc-num { font-weight: 700; font-size: 13px; color: #1a3a1e; font-family: 'DM Mono', monospace; letter-spacing: .5px; }
        .oc-date { font-size: 12px; color: #aaa; margin-top: 3px; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); }
        .oc-hdr-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .oc-badge { padding: 4px 12px; border-radius: 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); }
        .badge-confirmed,.badge-processing { background: #e8f5e9; color: #1b5e20; border: 1px solid #c8e6c9; }
        .badge-packed { background: #e3f2fd; color: #0d47a1; border: 1px solid #bbdefb; }
        .badge-shipped { background: #ede7f6; color: #4527a0; border: 1px solid #d1c4e9; }
        .badge-delivered { background: #e8f5e9; color: #1b5e20; border: 1px solid #a5d6a7; }
        .badge-pending { background: #fff8e1; color: #e65100; border: 1px solid #ffe082; }
        .badge-cancelled { background: #fdecea; color: #b71c1c; border: 1px solid #ffcdd2; }
        .badge-returned,.badge-return_requested,.badge-return_approved,.badge-return_received,.badge-refunded,.badge-refund_initiated,.badge-refund_completed,.badge-return_rejected { background: #fce4ec; color: #880e4f; border: 1px solid #f8bbd0; }
        .oc-total { font-family: 'Playfair Display', serif; font-weight: 700; font-size: 18px; color: #1a3a1e; }
        .oc-pay { font-size: 12px; color: #999; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); }
        .oc-items-row { margin-bottom: 12px; }
        .oc-imgs { display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
        .oc-img-box { width: 56px; height: 56px; border-radius: 10px; border: 1.5px solid #ede9e3; overflow: hidden; background: #f5f0e8; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .oc-img-more { width: 56px; height: 56px; border-radius: 10px; background: #f5f0e8; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: #888; border: 1.5px solid #ede9e3; }
        .oc-items-names { font-size: 13px; color: #666; line-height: 1.5; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); }
        .oc-status-msg { font-size: 12px; font-weight: 600; color: #2e7d32; margin-bottom: 10px; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); background: #f0faf0; padding: 7px 12px; border-radius: 8px; display: inline-block; }
        .track-chip { display: inline-flex; align-items: center; gap: 6px; background: #1a3a1e; color: #fff; padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 600; text-decoration: none; margin-bottom: 12px; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); transition: background .2s; }
        .track-chip:hover { background: #2d5233; }
        .oc-actions { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 14px; padding-top: 14px; border-top: 1px solid #f0ece6; }
        .oc-actions-left { display: flex; gap: 8px; flex-wrap: wrap; }
        .action-btn { display: inline-flex; align-items: center; gap: 5px; padding: 7px 14px; border-radius: 9px; font-size: 12px; font-weight: 600; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); cursor: pointer; transition: all .2s; text-decoration: none; border: 1.5px solid transparent; }
        .action-view { background: #f0f7f4; color: #1a3a1e; border-color: #c8e6c9; }
        .action-view:hover { background: #1a3a1e; color: #fff; border-color: #1a3a1e; }
        .action-invoice { background: #fafafa; color: #555; border-color: #e0e0e0; }
        .action-invoice:hover { background: #555; color: #fff; border-color: #555; }
        .action-return { background: #fff8e1; color: #b86a00; border-color: #ffe082; }
        .action-return:hover { background: #b86a00; color: #fff; border-color: #b86a00; }
        .action-support { background: #e8f5e9; color: #1a7a3a; border-color: #c8e6c9; }
        .action-support:hover { background: #1a7a3a; color: #fff; border-color: #1a7a3a; }

        /* Address cards */
        .addr-card { border: 1.5px solid #ede9e3; border-radius: 14px; padding: 18px; margin-bottom: 12px; }
        .addr-default { border-color: #a5d6a7; background: #f6fbf6; }
        .addr-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .addr-label { font-weight: 700; font-size: 13px; color: #1a3a1e; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); }
        .addr-tag { background: #e8f5e9; color: #1b5e20; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 6px; text-transform: uppercase; letter-spacing: .5px; }
        .addr-line { font-size: 13px; color: #555; line-height: 1.8; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); }
        .addr-actions { display: flex; gap: 8px; margin-top: 12px; }
        .addr-btn { padding: 7px 16px; border-radius: 9px; font-size: 12px; font-weight: 600; cursor: pointer; border: 1.5px solid #c8e6c9; color: #1a3a1e; background: #fff; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); transition: all .2s; }
        .addr-btn:hover { background: #1a3a1e; color: #fff; border-color: #1a3a1e; }
        .addr-del { border-color: #ffcdd2; color: #c0392b; }
        .addr-del:hover { background: #c0392b; color: #fff; border-color: #c0392b; }

        /* Forms */
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
        .form-full { grid-column: 1/-1; }
        @media(max-width: 500px) { .form-grid { grid-template-columns: 1fr; } }
        .form-actions { display: flex; align-items: center; gap: 14px; }
        .f-lbl { font-size: 11px; font-weight: 700; color: #aaa; text-transform: uppercase; letter-spacing: .6px; margin-bottom: 6px; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); }
        .f-inp { width: 100%; padding: 12px 14px; border: 1.5px solid #e8e3db; border-radius: 11px; font-size: 14px; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); color: #1a1a1a; transition: border-color .2s, box-shadow .2s; outline: none; background: #fafaf8; }
        .f-inp:focus { border-color: #1a3a1e; background: #fff; box-shadow: 0 0 0 3px rgba(26,58,30,.08); }
        .f-err { border-color: #e74c3c !important; background: #fff9f9; }
        .f-disabled { opacity: .55; cursor: not-allowed; background: #f5f5f5 !important; }
        .f-hint { font-size: 11px; color: #bbb; margin-top: 5px; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); }
        .err-txt { font-size: 11px; color: #e74c3c; margin-top: 5px; font-weight: 600; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); }
        .save-msg { font-size: 13px; color: #2d6a4f; font-weight: 600; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); }
        .phone-prefix { padding: 12px 13px; background: #f5f0e8; border-radius: 11px; font-size: 14px; font-weight: 700; color: #666; flex-shrink: 0; border: 1.5px solid #e8e3db; }

        /* Password */
        .pw-wrap { position: relative; }
        .pw-wrap .f-inp { padding-right: 44px; }
        .pw-eye { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 16px; padding: 2px; }
        .pw-strength { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
        .pw-bar { height: 4px; border-radius: 4px; flex: 1; transition: all .3s; }
        .pw-weak { background: #ef5350; width: 33%; }
        .pw-medium { background: #ffa726; width: 66%; }
        .pw-strong { background: #43a047; width: 100%; }
        .pw-strength-lbl { font-size: 11px; font-weight: 700; color: #888; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); }
        .match-msg { font-size: 12px; color: #2e7d32; font-weight: 600; margin-top: 5px; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); }

        /* Buttons */
        .btn-primary { background: linear-gradient(135deg, #1a3a1e, #2d5233); color: #fff; border: none; padding: 12px 26px; border-radius: 11px; font-size: 14px; font-weight: 700; cursor: pointer; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); transition: all .2s; display: inline-flex; align-items: center; gap: 6px; text-decoration: none; }
        .btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 5px 18px rgba(26,58,30,.28); }
        .btn-primary:disabled { opacity: .6; cursor: not-allowed; }
        .btn-secondary { background: #fff; color: #1a3a1e; border: 1.5px solid #c8e6c9; padding: 11px 22px; border-radius: 11px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); transition: all .2s; }
        .btn-secondary:hover { background: #f0f7f4; }

        /* Empty & login */
        .empty-state { text-align: center; padding: 52px 20px; }
        .empty-icon { font-size: 52px; margin-bottom: 16px; }
        .empty-title { font-family: 'Playfair Display', serif; font-size: 22px; color: #1a3a1e; margin-bottom: 8px; font-weight: 700; }
        .empty-sub { font-size: 14px; color: #999; margin-bottom: 24px; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); line-height: 1.6; }
        .login-wall { max-width: 440px; margin: 80px auto; background: #fff; border-radius: 24px; padding: 52px 36px; text-align: center; box-shadow: 0 4px 32px rgba(0,0,0,.07); border: 1px solid #ede9e3; }
        .lw-icon { font-size: 52px; margin-bottom: 16px; }
        .lw-title { font-family: 'Playfair Display', serif; font-size: 28px; color: #1a3a1e; margin-bottom: 10px; font-weight: 900; }
        .lw-sub { font-size: 14px; color: #999; margin-bottom: 28px; line-height: 1.7; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); }

        /* Loading */
        .acc-loading { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f4f0eb; }
        .loading-inner { text-align: center; }
        .loading-text { color: #aaa; font-size: 14px; margin-top: 12px; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); }
        .loading-orders { text-align: center; padding: 48px 20px; color: #aaa; font-size: 14px; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); }
        .loading-orders .acc-spinner { margin: 0 auto 12px; }
        .acc-spinner { width: 28px; height: 28px; border: 2.5px solid #e8e3db; border-top-color: #1a3a1e; border-radius: 50%; animation: acc-spin 1s linear infinite; margin: 0 auto 12px; }
        @keyframes acc-spin { to { transform: rotate(360deg); } }

        /* Mobile tabs */
        .mob-tabs { display: none; }
        @media(max-width: 900px) {
          .mob-tabs { display: flex; position: fixed; bottom: 0; left: 0; right: 0; background: #fff; border-top: 1px solid #ede9e3; z-index: 100; box-shadow: 0 -2px 20px rgba(0,0,0,.08); }
          .mob-tab { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px 4px; border: none; background: none; cursor: pointer; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); font-size: 9px; font-weight: 700; color: #bbb; gap: 3px; transition: color .2s; }
          .mob-tab.active { color: #1a3a1e; }
          .mt-icon { font-size: 19px; }
        }


        /* Add address */
        .add-addr-btn { display: flex; align-items: center; gap: 8px; width: 100%; padding: 14px 18px; border: 2px dashed #c8e6c9; border-radius: 14px; background: #f6fbf6; color: #2e7d32; font-size: 14px; font-weight: 700; cursor: pointer; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); transition: all .2s; margin-top: 4px; }
        .add-addr-btn:hover { border-color: #1a3a1e; background: #f0f7f4; color: #1a3a1e; }
        .addr-add-form { border: 1.5px solid #c8e6c9; border-radius: 16px; padding: 20px; background: #f6fbf6; margin-top: 8px; }
        .addr-add-title { font-family: var(--font-dm-sans, 'DM Sans', sans-serif); font-size: 14px; font-weight: 700; color: #1a3a1e; margin-bottom: 18px; }

        /* Toast */
        .acc-toast { position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%); background: #1a3a1e; color: #fff; padding: 11px 22px; border-radius: 12px; font-size: 13px; font-weight: 600; z-index: 9999; white-space: nowrap; box-shadow: 0 4px 20px rgba(0,0,0,.18); animation: toast-in .25s ease; font-family: var(--font-dm-sans, 'DM Sans', sans-serif); }
        .acc-toast-error { background: #c0392b; }
        @keyframes toast-in { from { opacity: 0; transform: translateX(-50%) translateY(10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
        @media(max-width: 768px) { .acc-toast { bottom: 72px; font-size: 12px; max-width: 88vw; white-space: normal; text-align: center; } }
      `}</style>
    </div>
  )
}
