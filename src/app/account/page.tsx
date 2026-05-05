'use client'

import { useState, useEffect, useCallback } from 'react'
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
  const router     = useRouter()
  const storeLogout = useUserStore(s => s.logout)

  const [tab,      setTab]      = useState<Tab>('orders')
  const [loaded,   setLoaded]   = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [profile,  setProfile]  = useState<any>(null)
  const [authUser, setAuthUser] = useState<any>(null)
  const [orders,   setOrders]   = useState<any[] | null>(null)
  const [filter,   setFilter]   = useState('all')
  const [search,   setSearch]   = useState('')
  const [toast,    setToast]    = useState('')
  const [token,    setToken]    = useState<string | null>(null)
  const [pf, setPf] = useState({ fname:'', lname:'', addr:'', city:'', state:'', pin:'', phone:'' })
  const [pfErr, setPfErr] = useState<Record<string,string>>({})
  const [pw,  setPw]  = useState({ newp:'', conf:'' })
  const [msg, setMsg] = useState<Record<string,string>>({})
  const [busy, setBusy] = useState<Record<string,boolean>>({})

  const toast$ = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2800) }
  const setMsg$ = (k: string, v: string) => { setMsg(m => ({...m,[k]:v})); setTimeout(() => setMsg(m => ({...m,[k]:''})), 2500) }

  const doInit = useCallback(async () => {
    const tk = getToken(); const cached = getProfile()
    if (!tk) { setLoaded(true); setLoggedIn(false); return }
    if (cached) {
      setProfile(cached); setLoggedIn(true); pfFrom(cached); setToken(tk); setLoaded(true)
      fetchOrders(tk); refreshProf(tk); return
    }
    try {
      const d = await callAuth('get_profile', {}, tk)
      if (!d.profile) { setLoaded(true); setLoggedIn(false); return }
      setProfile(d.profile); setAuthUser(d.user); saveProfile(d.profile); pfFrom(d.profile)
      setLoggedIn(true); setToken(tk); setLoaded(true); fetchOrders(tk)
    } catch {
      const rt = getRefresh()
      if (rt) { try {
        const r = await callAuth('refresh_token', { refresh_token: rt })
        if (r.access_token) {
          saveToken(r.access_token); if (r.refresh_token) saveRefresh(r.refresh_token)
          const d = await callAuth('get_profile', {}, r.access_token)
          setProfile(d.profile); saveProfile(d.profile); pfFrom(d.profile)
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

  useEffect(() => { doInit() }, [doInit])

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
    catch(e:any) { toast$('❌ '+e.message) } finally { setBusy(b=>({...b,name:false})) }
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
    catch(e:any) { toast$('❌ '+e.message) } finally { setBusy(b=>({...b,addr:false})) }
  }
  async function savePhone() {
    if (!isValidPhone(pf.phone)) { setPfErr(e=>({...e,phone:'Enter valid 10-digit mobile (starts with 6-9)'})); return }
    setPfErr(e=>({...e,phone:''})); setBusy(b=>({...b,phone:true}))
    try { await callAuth('update_profile',{phone:'+91'+pf.phone.replace(/\D/g,'')},token); const np={...profile,phone:'+91'+pf.phone}; setProfile(np); saveProfile(np); setMsg$('phone','✅ Phone saved!') }
    catch(e:any) { toast$('❌ '+e.message) } finally { setBusy(b=>({...b,phone:false})) }
  }
  async function changePassword() {
    const e: Record<string,string> = {}
    if (!pw.newp || pw.newp.length<6) e.newp='Minimum 6 characters'
    if (pw.newp !== pw.conf)          e.conf='Passwords do not match'
    if (Object.keys(e).length) { setPfErr(e); return } setPfErr({})
    setBusy(b=>({...b,pw:true}))
    try { await callAuth('change_password',{new_password:pw.newp},token); setPw({newp:'',conf:''}); toast$('✅ Password updated!') }
    catch(e:any) { toast$('❌ '+e.message) } finally { setBusy(b=>({...b,pw:false})) }
  }

  const savedAddrs = getSavedAddresses(profile)
  async function deleteAddr(idx: number) {
    const updated = savedAddrs.filter((_:any,i:number)=>i!==idx)
    try { await callAuth('update_profile',{saved_addresses:JSON.stringify(updated)},token); const np={...profile,saved_addresses:JSON.stringify(updated)}; setProfile(np); saveProfile(np); toast$('🗑 Address removed') }
    catch { toast$('❌ Remove failed') }
  }

  // ── Render: Loading ────────────────────────────────────────────────────
  if (!loaded) return (
    <div className="acc-loading"><div className="acc-spinner"/><p>Loading your account...</p></div>
  )

  if (!loggedIn) return (
    <div className="acc-wrap">
      <div className="login-wall">
        <div className="lw-icon">🔐</div>
        <div className="lw-title">Login Required</div>
        <p className="lw-sub">Login to view your orders, addresses and profile.</p>
        <Link href="/?login=1" className="btn-primary">👤 Login / Sign Up</Link>
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
  const filtered = (orders||[]).filter(o => {
    const s = o._displayStatus || o.order_status || ''
    const mF = filter==='all' || (filter==='active'&&ACTIVE.includes(s)) || (filter==='delivered'&&s==='delivered') || (filter==='returns'&&RETURNS.includes(s)) || (filter==='cancelled'&&s==='cancelled')
    const q  = search.toLowerCase().trim()
    const mQ = !q || (o.order_number||'').toLowerCase().includes(q) || (o.items||[]).some((i:any)=>(i.name||'').toLowerCase().includes(q))
    return mF && mQ
  })

  return (
    <div className="acc-wrap">
      <div className="acc-page">

        {/* SIDEBAR — no Dashboard, just: My Orders | Addresses | Profile | Change Password | Logout */}
        <aside className="sidebar">
          <div className="sb-profile">
            <div className="sb-avatar">{initials}</div>
            <div className="sb-name">{fullName}</div>
            {email  && <div className="sb-sub">{email}</div>}
            {!email && phone && <div className="sb-sub">{phone}</div>}
          </div>
          <div className="sb-nav">
            {([
              {key:'orders',    icon:'📦', label:'My Orders'},
              {key:'addresses', icon:'📍', label:'Addresses'},
              {key:'profile',   icon:'👤', label:'Profile'},
              {key:'password',  icon:'🔒', label:'Change Password'},
            ] as const).map(it => (
              <button key={it.key} className={`sb-item${tab===it.key?' active':''}`} onClick={()=>{setTab(it.key);if(it.key==='orders'&&!orders&&token)fetchOrders(token)}}>
                <span className="sb-icon">{it.icon}</span>{it.label}
              </button>
            ))}
            <div className="sb-div"/>
            <button className="sb-item sb-logout" onClick={doLogout}><span className="sb-icon">🚪</span>Logout</button>
          </div>
        </aside>

        {/* MAIN PANEL */}
        <div className="main-panel">

          {/* ORDERS */}
          {tab==='orders' && (
            <div className="card">
              <div className="card-title">📦 My Orders {orders!==null&&<span className="count-badge">({orders.length})</span>}</div>
              {orders===null ? (
                <div style={{textAlign:'center',padding:'40px'}}><div className="acc-spinner"/><p style={{color:'#888',fontSize:'14px',marginTop:'12px'}}>Loading orders...</p></div>
              ) : (
                <>
                  <div className="orders-toolbar">
                    <input className="orders-search" type="text" placeholder="🔍  Search by order # or product…" value={search} onChange={e=>setSearch(e.target.value)}/>
                    {['all','active','delivered','returns','cancelled'].map(f=>(
                      <button key={f} className={`filter-btn${filter===f?' active':''}`} onClick={()=>setFilter(f)}>
                        {f.charAt(0).toUpperCase()+f.slice(1)}
                      </button>
                    ))}
                  </div>
                  {filtered.length===0 ? (
                    <div className="empty-state">
                      <div className="empty-icon">📦</div>
                      <div className="empty-title">{orders.length===0?'No orders yet':'No orders found'}</div>
                      <p className="empty-sub">{orders.length===0?'Shop our Himalayan products!':'Try a different filter.'}</p>
                      {orders.length===0&&<Link href="/products" className="btn-primary">🛍️ Shop Now</Link>}
                    </div>
                  ) : filtered.map((o:any) => {
                    const ds    = o._displayStatus||o.order_status||'pending'
                    const badge = BADGE_CLASS[ds]||'badge-pending'
                    const stripe= STRIPE[ds]||'oc-stripe-pending'
                    const label = STATUS_LABEL[ds]||ds
                    const date  = o.created_at ? new Date(o.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : ''
                    const items = o.items||[]
                    const trackUrl = o.tracking_number ? `https://www.google.com/search?q=${o.courier||''} tracking ${o.tracking_number}` : ''
                    let statusMsg = ''
                    if (ds==='delivered')        statusMsg = '✅ Delivered! Enjoy your Himalayan goodness 🌿'
                    else if (ds==='shipped'&&o.shipped_at) { const est=new Date(o.shipped_at);est.setDate(est.getDate()+5);statusMsg=`🚚 Shipped · Est. ${est.toLocaleDateString('en-IN',{day:'numeric',month:'short'})}` }
                    else if (ds==='return_requested') statusMsg = '⏳ Return under review · 24–48 hrs'
                    else if (ds==='refund_completed') statusMsg = '💚 Refund credited!'
                    else if (ds==='cancelled')        statusMsg = '❌ Order cancelled'
                    return (
                      <div key={o.id} className="order-card">
                        <div className={`oc-stripe ${stripe}`}/>
                        <div className="oc-inner">
                          <div className="oc-hdr">
                            <div>
                              <div className="oc-num">{o.order_number||'#'+String(o.id).slice(0,8)}</div>
                              <div className="oc-date">{date}</div>
                            </div>
                            <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
                              <span className={`oc-badge ${badge}`}>{label}</span>
                              <span className="oc-total">₹{(o.total_amount||0).toLocaleString('en-IN')}</span>
                              {o.payment_method&&<span className="oc-pay">{o.payment_method==='cod'?'💵 COD':'💳 Prepaid'}</span>}
                            </div>
                          </div>
                          {items.length>0&&(
                            <div className="oc-imgs">
                              {items.slice(0,4).map((it:any,i:number)=>(
                                <div key={i} className="oc-img-box">
                                  {it.image_url ? <img src={it.image_url} alt={it.name||''} style={{width:'100%',height:'100%',objectFit:'cover'}}/> : <span style={{fontSize:'22px'}}>{it.emoji||'🌿'}</span>}
                                </div>
                              ))}
                              {items.length>4&&<div className="oc-img-more">+{items.length-4}</div>}
                            </div>
                          )}
                          <div className="oc-items">{items.slice(0,3).map((i:any)=>`${i.name||'Product'} ×${i.qty||1}`).join(' · ')}{items.length>3&&` & ${items.length-3} more`}</div>
                          {statusMsg&&<div className="oc-status-msg">{statusMsg}</div>}
                          {trackUrl&&<a href={trackUrl} target="_blank" rel="noopener noreferrer" className="track-chip">🚚 Track{o.tracking_number?' · '+o.tracking_number:''}</a>}
                          <div className="oc-actions">
                            <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
                              <Link href={`/order-confirmation?id=${o.id}&num=${encodeURIComponent(o.order_number||'')}`} className="view-chip">📄 View Details</Link>
                              <Link href={`/order-confirmation?id=${o.id}&num=${encodeURIComponent(o.order_number||'')}&print=1`} className="view-chip" target="_blank">🧾 Invoice</Link>
                              {ds==='delivered'&&<button className="ret-btn" onClick={()=>toast$('↩ Contact support for returns')}>↩ Return</button>}
                            </div>
                            <a href={`https://wa.me/919899984895?text=${encodeURIComponent('Hi, help needed with order '+(o.order_number||'')+'.')}`} target="_blank" rel="noopener noreferrer" className="sup-btn">💬 Support</a>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          )}

          {/* ADDRESSES */}
          {tab==='addresses' && (
            <div className="card">
              <div className="card-title">📍 Delivery Addresses</div>
              {profile?.address_line1 && (
                <div className="addr-card addr-default">
                  <div className="addr-label">🏠 Default Address</div>
                  <div className="addr-line">
                    {[profile?.first_name,profile?.last_name].filter(Boolean).join(' ')}<br/>
                    {[profile?.address_line1,profile?.city,profile?.state,profile?.postal_code].filter(Boolean).join(', ')}
                    {profile?.phone&&<><br/>{profile.phone}</>}
                  </div>
                  <div className="addr-actions"><button className="addr-btn" onClick={()=>setTab('profile')}>✏️ Edit</button></div>
                </div>
              )}
              {savedAddrs.filter((a:any)=>a.label!=='Default').map((a:any,i:number)=>(
                <div key={i} className="addr-card">
                  <div className="addr-label">📍 {a.label||'Saved'}</div>
                  <div className="addr-line">{a.name&&<>{a.name}<br/></>}{[a.addr||a.flat,a.city,a.state,a.pin||a.pincode].filter(Boolean).join(', ')}</div>
                  <div className="addr-actions"><button className="addr-btn addr-del" onClick={()=>deleteAddr(i)}>🗑 Remove</button></div>
                </div>
              ))}
              {!profile?.address_line1&&savedAddrs.length===0&&(
                <div className="empty-state">
                  <div className="empty-icon">📍</div>
                  <div className="empty-title">No addresses saved</div>
                  <p className="empty-sub">Add your delivery address in Profile.</p>
                  <button className="btn-primary" onClick={()=>setTab('profile')}>👤 Go to Profile</button>
                </div>
              )}
            </div>
          )}

          {/* PROFILE */}
          {tab==='profile' && (
            <>
              <div className="card">
                <div className="card-title">👤 Personal Info</div>
                <div className="form-grid">
                  <div>
                    <div className="f-lbl">First Name *</div>
                    <input className={`f-inp${pfErr.fname?' f-err':''}`} value={pf.fname} onChange={e=>{setPf(p=>({...p,fname:e.target.value}));setPfErr(er=>({...er,fname:''}))}} placeholder="First name"/>
                    {pfErr.fname&&<div className="err-txt">{pfErr.fname}</div>}
                  </div>
                  <div>
                    <div className="f-lbl">Last Name</div>
                    <input className="f-inp" value={pf.lname} onChange={e=>setPf(p=>({...p,lname:e.target.value}))} placeholder="Last name"/>
                  </div>
                </div>
                <button className="btn-primary" onClick={saveName} disabled={!!busy.name}>{busy.name?'Saving…':'💾 Save Name'}</button>
                {msg.name&&<div className="save-msg">{msg.name}</div>}
              </div>

              <div className="card">
                <div className="card-title">📍 Default Delivery Address</div>
                <div className="form-grid">
                  <div className="form-full">
                    <div className="f-lbl">Street / Flat / Colony *</div>
                    <input className={`f-inp${pfErr.addr?' f-err':''}`} value={pf.addr} onChange={e=>{setPf(p=>({...p,addr:e.target.value}));setPfErr(er=>({...er,addr:''}))}} placeholder="House no., Street, Colony"/>
                    {pfErr.addr&&<div className="err-txt">{pfErr.addr}</div>}
                  </div>
                  <div>
                    <div className="f-lbl">City *</div>
                    <input className={`f-inp${pfErr.city?' f-err':''}`} value={pf.city} onChange={e=>{setPf(p=>({...p,city:e.target.value}));setPfErr(er=>({...er,city:''}))}} placeholder="City"/>
                    {pfErr.city&&<div className="err-txt">{pfErr.city}</div>}
                  </div>
                  <div>
                    <div className="f-lbl">State *</div>
                    <select className={`f-inp${pfErr.state?' f-err':''}`} value={pf.state} onChange={e=>{setPf(p=>({...p,state:e.target.value}));setPfErr(er=>({...er,state:''}))}} >
                      <option value="">Select State / UT</option>
                      {INDIA_STATES.map(s=><option key={s}>{s}</option>)}
                    </select>
                    {pfErr.state&&<div className="err-txt">{pfErr.state}</div>}
                  </div>
                  <div>
                    <div className="f-lbl">Pincode</div>
                    <input className={`f-inp${pfErr.pin?' f-err':''}`} value={pf.pin} onChange={e=>{setPf(p=>({...p,pin:e.target.value.replace(/\D/g,'')}));setPfErr(er=>({...er,pin:''}))}} placeholder="110001" maxLength={6} inputMode="numeric"/>
                    {pfErr.pin&&<div className="err-txt">{pfErr.pin}</div>}
                  </div>
                </div>
                <button className="btn-primary" onClick={saveAddr} disabled={!!busy.addr}>{busy.addr?'Saving…':'💾 Save Address'}</button>
                {msg.addr&&<div className="save-msg">{msg.addr}</div>}
              </div>

              <div className="card">
                <div className="card-title">📱 Contact Info</div>
                <div className="form-grid">
                  <div>
                    <div className="f-lbl">Phone Number</div>
                    <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
                      <span style={{padding:'11px 12px',background:'#f5f5f5',borderRadius:'10px',fontSize:'14px',fontWeight:700,color:'#555',flexShrink:0}}>+91</span>
                      <input className={`f-inp${pfErr.phone?' f-err':''}`} style={{flex:1}} value={pf.phone} onChange={e=>{setPf(p=>({...p,phone:e.target.value.replace(/\D/g,'')}));setPfErr(er=>({...er,phone:''}))}} placeholder="10-digit mobile" maxLength={10} inputMode="numeric"/>
                    </div>
                    {pfErr.phone&&<div className="err-txt">{pfErr.phone}</div>}
                  </div>
                  <div>
                    <div className="f-lbl">Email</div>
                    <input className="f-inp" value={email} disabled style={{opacity:.6,cursor:'not-allowed',background:'#f8f8f8'}}/>
                    <div style={{fontSize:'11px',color:'#aaa',marginTop:'4px'}}>Email cannot be changed here</div>
                  </div>
                </div>
                <button className="btn-primary" onClick={savePhone} disabled={!!busy.phone}>{busy.phone?'Saving…':'💾 Save Phone'}</button>
                {msg.phone&&<div className="save-msg">{msg.phone}</div>}
              </div>
            </>
          )}

          {/* PASSWORD */}
          {tab==='password' && (
            <div className="card">
              <div className="card-title">🔒 Change Password</div>
              <div className="form-grid">
                <div className="form-full">
                  <div className="f-lbl">New Password *</div>
                  <input className={`f-inp${pfErr.newp?' f-err':''}`} type="password" value={pw.newp} onChange={e=>{setPw(p=>({...p,newp:e.target.value}));setPfErr(er=>({...er,newp:''}))}} placeholder="Minimum 6 characters"/>
                  {pfErr.newp&&<div className="err-txt">{pfErr.newp}</div>}
                </div>
                <div className="form-full">
                  <div className="f-lbl">Confirm Password *</div>
                  <input className={`f-inp${pfErr.conf?' f-err':''}`} type="password" value={pw.conf} onChange={e=>{setPw(p=>({...p,conf:e.target.value}));setPfErr(er=>({...er,conf:''}))}} placeholder="Repeat new password"/>
                  {pfErr.conf&&<div className="err-txt">{pfErr.conf}</div>}
                </div>
              </div>
              <button className="btn-primary" onClick={changePassword} disabled={!!busy.pw}>{busy.pw?'Updating…':'🔒 Update Password'}</button>
            </div>
          )}

        </div>
      </div>

      {/* Mobile tabs */}
      <div className="mob-tabs">
        {([{key:'orders',icon:'📦',label:'Orders'},{key:'addresses',icon:'📍',label:'Addresses'},{key:'profile',icon:'👤',label:'Profile'},{key:'password',icon:'🔒',label:'Password'}] as const).map(it=>(
          <button key={it.key} className={`mob-tab${tab===it.key?' active':''}`} onClick={()=>{setTab(it.key);if(it.key==='orders'&&!orders&&token)fetchOrders(token)}}><span className="mt-icon">{it.icon}</span>{it.label}</button>
        ))}
        <button className="mob-tab" onClick={doLogout}><span className="mt-icon">🚪</span>Logout</button>
      </div>

      {toast&&<div className="acc-toast">{toast}</div>}

      <style>{`
        .acc-wrap{background:#f7f3ee;min-height:100vh;padding:28px 20px 80px}
        .acc-page{max-width:1100px;margin:0 auto;display:grid;grid-template-columns:280px 1fr;gap:28px;align-items:start}
        @media(max-width:768px){.acc-page{grid-template-columns:1fr}.acc-wrap{padding:12px 12px 80px}}

        /* Sidebar */
        .sidebar{background:#fdfaf4;border-radius:18px;overflow:hidden;box-shadow:0 4px 24px rgba(26,58,30,.1);border:1px solid rgba(200,146,10,.25);position:sticky;top:76px}
        .sb-profile{background:linear-gradient(135deg,#1a3a1e,#2d5233);padding:24px;text-align:center}
        .sb-avatar{width:64px;height:64px;background:rgba(255,255,255,.2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-size:28px;font-weight:900;color:#fff;border:3px solid rgba(255,255,255,.3);margin:0 auto 12px}
        .sb-name{font-family:'Playfair Display',serif;font-size:18px;font-weight:900;color:#fff;margin-bottom:3px}
        .sb-sub{font-size:12px;color:rgba(255,255,255,.65)}
        .sb-nav{padding:8px 0}
        .sb-item{display:flex;align-items:center;gap:12px;padding:13px 20px;cursor:pointer;transition:all .2s;border:none;background:none;width:100%;text-align:left;font-family:'Lato',sans-serif;font-size:14px;font-weight:700;color:#4a4a4a;border-left:3px solid transparent}
        .sb-item:hover{background:rgba(200,146,10,.08);color:#1a3a1e}
        .sb-item.active{background:rgba(26,58,30,.07);color:#1a3a1e;border-left-color:#1a3a1e}
        .sb-icon{font-size:16px;width:20px;text-align:center}
        .sb-div{height:1px;background:rgba(200,146,10,.15);margin:8px 0}
        .sb-logout{color:#c0392b}.sb-logout:hover{background:#fdecea}
        @media(max-width:768px){.sidebar{display:none}}

        /* Main */
        .main-panel{display:flex;flex-direction:column;gap:20px}
        .card{background:#fdfaf4;border-radius:18px;padding:24px;box-shadow:0 4px 24px rgba(26,58,30,.09);border:1px solid rgba(200,146,10,.2)}
        .card-title{font-family:'Playfair Display',serif;font-size:18px;font-weight:700;color:#1a3a1e;margin-bottom:20px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
        .count-badge{font-size:14px;font-weight:400;color:#7a7a7a;font-family:Lato,sans-serif}

        /* Orders toolbar */
        .orders-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:20px}
        .orders-search{flex:1;min-width:160px;padding:10px 16px;border:1.5px solid #e0e0e0;border-radius:24px;font-size:13px;font-family:Lato,sans-serif;outline:none;transition:border-color .2s;background:#fafafa}
        .orders-search:focus{border-color:#1a3a1e;background:#fff}
        .filter-btn{padding:8px 14px;border-radius:20px;border:1.5px solid #e0e0e0;background:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:Lato,sans-serif;transition:all .2s;color:#555}
        .filter-btn:hover,.filter-btn.active{background:#1a3a1e;color:#fff;border-color:#1a3a1e}

        /* Order card */
        .order-card{border:1px solid rgba(200,146,10,.18);border-radius:20px;margin-bottom:20px;overflow:hidden;background:#fdfaf4;box-shadow:0 4px 20px rgba(26,58,30,.08);transition:transform .2s,box-shadow .2s}
        .order-card:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(26,58,30,.13)}
        .oc-stripe{height:5px}
        .oc-stripe-confirmed{background:linear-gradient(90deg,#43a047,#66bb6a)}
        .oc-stripe-packed{background:linear-gradient(90deg,#1565c0,#42a5f5)}
        .oc-stripe-shipped{background:linear-gradient(90deg,#5e35b1,#9575cd)}
        .oc-stripe-delivered{background:linear-gradient(90deg,#2e7d32,#66bb6a)}
        .oc-stripe-pending{background:linear-gradient(90deg,#e65100,#ffa726)}
        .oc-stripe-cancelled{background:linear-gradient(90deg,#b71c1c,#ef5350)}
        .oc-stripe-processing{background:linear-gradient(90deg,#1a3a1e,#43a047)}
        .oc-stripe-returned,.oc-stripe-return_requested,.oc-stripe-return_approved,.oc-stripe-return_received,.oc-stripe-refunded,.oc-stripe-refund_initiated,.oc-stripe-refund_completed,.oc-stripe-return_rejected{background:linear-gradient(90deg,#7b1fa2,#ce93d8)}
        .oc-inner{padding:18px 22px}
        .oc-hdr{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;padding-bottom:12px;border-bottom:1px solid #f0f0f0;margin-bottom:12px}
        .oc-num{font-weight:900;font-size:14px;color:#1a3a1e;font-family:monospace}
        .oc-date{font-size:12px;color:#888;margin-top:2px}
        .oc-badge{padding:4px 12px;border-radius:20px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.4px}
        .badge-confirmed,.badge-processing{background:linear-gradient(135deg,#e8f5e9,#c8e6c9);color:#1b5e20;border:1px solid #a5d6a7}
        .badge-packed{background:linear-gradient(135deg,#e3f2fd,#bbdefb);color:#0d47a1;border:1px solid #90caf9}
        .badge-shipped{background:linear-gradient(135deg,#ede7f6,#d1c4e9);color:#4527a0;border:1px solid #b39ddb}
        .badge-delivered{background:linear-gradient(135deg,#e8f5e9,#a5d6a7);color:#1b5e20;border:1px solid #81c784}
        .badge-pending{background:linear-gradient(135deg,#fff8e1,#ffecb3);color:#e65100;border:1px solid #ffd54f}
        .badge-cancelled{background:linear-gradient(135deg,#fdecea,#ffcdd2);color:#b71c1c;border:1px solid #ef9a9a}
        .badge-returned,.badge-return_requested,.badge-return_approved,.badge-return_received,.badge-refunded,.badge-refund_initiated,.badge-refund_completed,.badge-return_rejected{background:linear-gradient(135deg,#fce4ec,#f8bbd0);color:#c62828;border:1px solid #f48fb1}
        .oc-total{font-weight:900;font-size:16px;color:#1a3a1e}
        .oc-pay{font-size:12px;color:#888}
        .oc-imgs{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap}
        .oc-img-box{width:60px;height:60px;border-radius:10px;border:1.5px solid #eee;overflow:hidden;background:#f5f0e8;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .oc-img-more{width:60px;height:60px;border-radius:10px;background:#f5f5f5;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#7a7a7a;border:1.5px solid #eee}
        .oc-items{font-size:13px;color:#555;margin-bottom:8px;line-height:1.6}
        .oc-status-msg{font-size:12px;font-weight:700;color:#2e7d32;margin-bottom:8px}
        .track-chip{display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#1a3a1e,#2d5233);color:#fff;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:800;text-decoration:none;margin-bottom:10px}
        .oc-actions{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid #f0f0f0}
        .view-chip{display:inline-flex;align-items:center;gap:4px;background:#f0f7f4;color:#1a3a1e;border:1.5px solid #c8e6c9;padding:6px 13px;border-radius:20px;font-size:12px;font-weight:800;text-decoration:none;transition:all .2s}
        .view-chip:hover{background:#1a3a1e;color:#fff}
        .ret-btn{display:inline-flex;align-items:center;gap:4px;background:#fff5f5;color:#c0392b;border:1.5px solid #fdecea;padding:6px 13px;border-radius:20px;font-size:12px;font-weight:800;cursor:pointer;font-family:Lato,sans-serif;transition:all .2s}
        .ret-btn:hover{background:#c0392b;color:#fff}
        .sup-btn{display:inline-flex;align-items:center;gap:6px;background:#fff;color:#1a7a3a;border:1.5px solid #c8e6c9;padding:6px 13px;border-radius:20px;font-size:12px;font-weight:800;text-decoration:none;transition:all .2s}
        .sup-btn:hover{background:#e8f5e9}

        /* Address cards */
        .addr-card{border:1.5px solid #eee;border-radius:14px;padding:14px 16px;margin-bottom:10px}
        .addr-default{border-color:#c8e6c9;background:#f0f7f4}
        .addr-label{font-weight:800;font-size:13px;color:#1a3a1e;margin-bottom:6px}
        .addr-line{font-size:13px;color:#4a4a4a;line-height:1.7}
        .addr-actions{display:flex;gap:8px;margin-top:10px}
        .addr-btn{padding:5px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;border:1.5px solid #c8e6c9;color:#1a3a1e;background:#fff;font-family:Lato,sans-serif;transition:all .2s}
        .addr-btn:hover{background:#1a3a1e;color:#fff}
        .addr-del{border-color:#fdecea;color:#c0392b}.addr-del:hover{background:#fdecea;color:#c0392b}

        /* Form */
        .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}
        .form-full{grid-column:1/-1}
        @media(max-width:500px){.form-grid{grid-template-columns:1fr}}
        .f-lbl{font-size:11px;font-weight:800;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px}
        .f-inp{width:100%;padding:11px 14px;border:1.5px solid #e0e0e0;border-radius:10px;font-size:14px;font-family:Lato,sans-serif;color:#1a1a1a;transition:border-color .2s;outline:none;background:#fff;box-sizing:border-box}
        .f-inp:focus{border-color:#1a3a1e}
        .f-err{border-color:#e74c3c!important;background:#fff9f9}
        .err-txt{font-size:11px;color:#e74c3c;margin-top:4px;font-weight:700}
        .save-msg{font-size:12px;color:#2d6a4f;margin-top:8px;font-weight:700}

        /* Buttons */
        .btn-primary{background:linear-gradient(135deg,#1a3a1e,#2d5233);color:#fff;border:none;padding:12px 24px;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;font-family:Lato,sans-serif;transition:all .2s;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
        .btn-primary:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 16px rgba(26,58,30,.25)}
        .btn-primary:disabled{opacity:.6;cursor:not-allowed}

        /* Empty & login wall */
        .empty-state{text-align:center;padding:48px 20px}
        .empty-icon{font-size:48px;margin-bottom:16px}
        .empty-title{font-family:'Playfair Display',serif;font-size:20px;color:#1a3a1e;margin-bottom:8px;font-weight:700}
        .empty-sub{font-size:14px;color:#7a7a7a;margin-bottom:24px}
        .login-wall{max-width:480px;margin:60px auto;background:#fff;border-radius:18px;padding:48px 32px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.06)}
        .lw-icon{font-size:56px;margin-bottom:16px}
        .lw-title{font-family:'Playfair Display',serif;font-size:26px;color:#1a3a1e;margin-bottom:8px;font-weight:900}
        .lw-sub{font-size:14px;color:#7a7a7a;margin-bottom:28px;line-height:1.6}

        /* Loading */
        .acc-loading{text-align:center;padding:80px 20px;background:#f7f3ee;min-height:100vh}
        .acc-spinner{width:32px;height:32px;border:3px solid #eee;border-top-color:#1a3a1e;border-radius:50%;animation:acc-spin 1s linear infinite;margin:0 auto 12px}
        @keyframes acc-spin{to{transform:rotate(360deg)}}

        /* Mobile tabs */
        .mob-tabs{display:none}
        @media(max-width:768px){
          .mob-tabs{display:flex;position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #eee;z-index:100;box-shadow:0 -4px 16px rgba(0,0,0,.08)}
          .mob-tab{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px 4px;border:none;background:none;cursor:pointer;font-family:Lato,sans-serif;font-size:9px;font-weight:700;color:#aaa;gap:2px;transition:color .2s}
          .mob-tab.active{color:#1a3a1e}
          .mt-icon{font-size:18px}
        }

        /* Toast */
        .acc-toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1a3a1e;color:#fff;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:700;z-index:9999;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.2);animation:toast-in .2s ease}
        @keyframes toast-in{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        @media(max-width:768px){.acc-toast{bottom:70px;font-size:12px;max-width:88vw;white-space:normal;text-align:center}}
      `}</style>
    </div>
  )
}
