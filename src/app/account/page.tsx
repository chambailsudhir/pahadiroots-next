'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import Link from 'next/link'
import { useAuth }    from './hooks/useAuth'
import { useUIStore } from '@/store/uiStore'
import { useOrders }  from './hooks/useOrders'
import { useProfile } from './hooks/useProfile'
import Sidebar        from './_components/Sidebar'
import OrderCard      from './_components/OrderCard'
import OrdersSkeleton from './_components/OrdersSkeleton'
import ErrorBoundary  from '@/components/ui/ErrorBoundary'
import { INDIA_STATES, ADDRESS_LABELS } from '@/lib/account/constants'
import { getSavedAddresses, formatCurrency } from '@/lib/account/utils'
import type { Profile } from './hooks/useAuth'
import type { SavedAddress } from './hooks/useProfile'
import type { Order } from './hooks/useOrders'

type Tab = 'orders' | 'addresses' | 'profile' | 'password'

// ── Toast hook — timer cleaned up, no memory leak ────────────
function useToast() {
  const [toast,     setToast]     = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function show(msg: string, type: 'success' | 'error' = 'success') {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast(msg); setToastType(type)
    timerRef.current = setTimeout(() => setToast(''), 3500)
  }
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
  return { toast, toastType, show }
}

// ─────────────────────────────────────────────────────────────
// FIXES in this file (audit rounds 1 + 2):
//  ✅ mounted hydration gate removed — auth.loaded is the correct gate
//  ✅ auth.init() decoupled from mounted — runs in useEffect([])
//  ✅ savedAddrs memoized from profile.saved_addresses string (stable dep)
//  ✅ savedAddrsList dep is [savedAddrs] — no JSON.stringify workaround
//  ✅ No eslint-disable suppressions anywhere in this file
//  ✅ Orders effect has full honest dep array
//  ✅ search-clear button has type="button"
//  ✅ (o: any) in OrderCard map → typed as Order
//
// KNOWN LIMITATIONS (require larger architectural decisions):
//  ⚠️  Page renders all tabs in one tree — splitting to sub-routes
//      (/account/orders, /account/profile) would scope rerenders
//      but requires routing restructure outside this file.
//  ⚠️  'use client' at page level — SSR of this page is limited
//      by the nature of auth-gated, personalised content.
// ─────────────────────────────────────────────────────────────
// ── Shared styles — rendered in every return path ─────────
function AccountStyles() {
  return (
    <style>{`
        *,*::before,*::after{box-sizing:border-box}
        .acc-wrap{background:#f4f0eb;min-height:100vh;padding:32px 24px 100px}
        .acc-page{max-width:1180px;margin:0 auto;display:grid;grid-template-columns:270px 1fr;gap:28px;align-items:start}
        @media(max-width:900px){.acc-page{grid-template-columns:1fr}.acc-wrap{padding:16px 14px 90px}}

        /* Sidebar */
        .sidebar{background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 2px 24px rgba(26,58,30,.1);border:1px solid rgba(200,146,10,.18);position:sticky;top:80px}
        .sb-profile{background:linear-gradient(160deg,#1a3a1e 0%,#2d5233 60%,#3a6b40 100%);padding:28px 20px 20px;text-align:center;position:relative}
        .sb-profile::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:20px;background:#fff;border-radius:20px 20px 0 0}
        .sb-avatar-ring{width:72px;height:72px;border-radius:50%;padding:3px;background:linear-gradient(135deg,rgba(255,255,255,.5),rgba(255,255,255,.1));margin:0 auto 12px}
        .sb-avatar{width:100%;height:100%;background:rgba(255,255,255,.15);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:900;color:#fff}
        .sb-name{font-size:17px;font-weight:700;color:#fff;margin-bottom:4px}
        .sb-sub{font-size:12px;color:rgba(255,255,255,.6);word-break:break-all}
        .sb-member{font-size:11px;color:rgba(255,255,255,.4);margin-top:6px}
        .sb-stats{display:flex;align-items:center;justify-content:space-around;padding:14px 12px;border-bottom:1px solid #f0ece6;margin-top:-4px}
        .sb-stat{text-align:center;flex:1}
        .sb-stat-val{font-size:18px;font-weight:700;color:#1a3a1e}
        .sb-stat-lbl{font-size:10px;font-weight:600;color:#aaa;text-transform:uppercase;letter-spacing:.4px;margin-top:2px}
        .sb-stat-div{width:1px;height:32px;background:#eee}
        .sb-nav{padding:6px 0 8px}
        .sb-item{display:flex;align-items:center;gap:11px;padding:12px 20px;cursor:pointer;transition:all .2s;border:none;background:none;width:100%;text-align:left;font-size:14px;font-weight:600;color:#555;border-left:3px solid transparent;text-decoration:none}
        .sb-item:hover{background:rgba(26,58,30,.05);color:#1a3a1e}
        .sb-item.active{background:linear-gradient(90deg,rgba(26,58,30,.08),transparent);color:#1a3a1e;border-left-color:#1a3a1e}
        .sb-icon{font-size:15px;width:20px;text-align:center;flex-shrink:0}
        .sb-label{flex:1}
        .sb-badge{background:#e8f5e9;color:#1b5e20;font-size:10px;font-weight:800;padding:2px 7px;border-radius:10px}
        .sb-div{height:1px;background:#f0ece6;margin:6px 0}
        .sb-wishlist{color:#c0392b}.sb-wishlist:hover{background:rgba(192,57,43,.05);color:#c0392b}
        .sb-logout{color:#c0392b}.sb-logout:hover{background:#fdecea;color:#c0392b}
        @media(max-width:900px){.sidebar{display:none}}

        /* Main */
        .main-panel{display:flex;flex-direction:column;gap:0}
        .panel-section{display:flex;flex-direction:column;gap:16px}
        .panel-header{display:flex;align-items:baseline;gap:12px;margin-bottom:4px}
        .panel-title{font-size:24px;font-weight:700;color:#1a3a1e}
        .panel-count{font-size:14px;color:#aaa;font-weight:500}

        /* Summary strip */
        .order-summary-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
        @media(max-width:600px){.order-summary-strip{grid-template-columns:repeat(2,1fr)}}
        .oss-item{background:#fff;border-radius:14px;padding:14px 16px;border:1px solid #ede9e3;display:flex;flex-direction:column;gap:4px}
        .oss-num{font-size:22px;font-weight:700}
        .oss-lbl{font-size:11px;font-weight:600;color:#aaa;text-transform:uppercase;letter-spacing:.4px}
        .oss-delivered .oss-num{color:#2e7d32}.oss-active .oss-num{color:#5e35b1}.oss-cancelled .oss-num{color:#c0392b}.oss-spent .oss-num{color:#1a3a1e}

        /* Card */
        .card{background:#fff;border-radius:20px;padding:28px;box-shadow:0 2px 20px rgba(26,58,30,.07);border:1px solid #ede9e3}
        .card-section-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#b8a882;margin-bottom:20px;padding-bottom:12px;border-bottom:1px solid #f5f0e8}

        /* Orders toolbar */
        .orders-toolbar{display:flex;flex-direction:column;gap:12px;margin-bottom:24px}
        .search-wrap{position:relative;display:flex;align-items:center}
        .search-icon{position:absolute;left:14px;font-size:14px}
        .orders-search{width:100%;padding:11px 40px;border:1.5px solid #e8e3db;border-radius:12px;font-size:14px;outline:none;transition:border-color .2s;background:#fafaf8;color:#1a1a1a}
        .orders-search:focus{border-color:#1a3a1e;background:#fff}
        .orders-search::placeholder{color:#bbb}
        .search-clear{position:absolute;right:12px;background:none;border:none;cursor:pointer;font-size:13px;color:#aaa;padding:4px}
        .search-clear:hover{color:#555}
        .filter-row{display:flex;gap:8px;flex-wrap:wrap}
        .filter-btn{padding:8px 16px;border-radius:10px;border:1.5px solid #e8e3db;background:#fff;font-size:12px;font-weight:600;cursor:pointer;transition:all .2s;color:#666}
        .filter-btn:hover{border-color:#1a3a1e;color:#1a3a1e}
        .filter-btn.active{background:#1a3a1e;color:#fff;border-color:#1a3a1e}

        /* Order card */
        .order-card{border:1px solid #ede9e3;border-radius:16px;margin-bottom:16px;overflow:hidden;background:#fdfcfa;transition:box-shadow .25s,transform .2s}
        .order-card:hover{box-shadow:0 6px 28px rgba(26,58,30,.12);transform:translateY(-1px)}
        .oc-stripe{height:4px}
        .oc-stripe-confirmed{background:linear-gradient(90deg,#43a047,#66bb6a)}
        .oc-stripe-packed{background:linear-gradient(90deg,#1565c0,#42a5f5)}
        .oc-stripe-shipped{background:linear-gradient(90deg,#5e35b1,#9575cd)}
        .oc-stripe-delivered{background:linear-gradient(90deg,#2e7d32,#66bb6a)}
        .oc-stripe-pending{background:linear-gradient(90deg,#e65100,#ffa726)}
        .oc-stripe-cancelled{background:linear-gradient(90deg,#b71c1c,#ef5350)}
        .oc-stripe-processing{background:linear-gradient(90deg,#1a3a1e,#43a047)}
        .oc-stripe-returned,.oc-stripe-return_requested,.oc-stripe-return_approved,.oc-stripe-return_received,.oc-stripe-refunded,.oc-stripe-refund_initiated,.oc-stripe-refund_completed,.oc-stripe-return_rejected{background:linear-gradient(90deg,#7b1fa2,#ce93d8)}
        .oc-inner{padding:20px 24px}
        .oc-hdr{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;padding-bottom:14px;border-bottom:1px solid #f0ece6;margin-bottom:14px}
        .oc-num{font-weight:700;font-size:13px;color:#1a3a1e;letter-spacing:.5px}
        .oc-date{font-size:12px;color:#aaa;margin-top:3px}
        .oc-hdr-right{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
        .oc-badge{padding:4px 12px;border-radius:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
        .badge-confirmed,.badge-processing{background:#e8f5e9;color:#1b5e20;border:1px solid #c8e6c9}
        .badge-packed{background:#e3f2fd;color:#0d47a1;border:1px solid #bbdefb}
        .badge-shipped{background:#ede7f6;color:#4527a0;border:1px solid #d1c4e9}
        .badge-delivered{background:#e8f5e9;color:#1b5e20;border:1px solid #a5d6a7}
        .badge-pending{background:#fff8e1;color:#e65100;border:1px solid #ffe082}
        .badge-cancelled{background:#fdecea;color:#b71c1c;border:1px solid #ffcdd2}
        .badge-returned,.badge-return_requested,.badge-return_approved,.badge-return_received,.badge-refunded,.badge-refund_initiated,.badge-refund_completed,.badge-return_rejected{background:#fce4ec;color:#880e4f;border:1px solid #f8bbd0}
        .oc-total{font-weight:700;font-size:18px;color:#1a3a1e}
        .oc-pay{font-size:11px;font-weight:700;padding:3px 9px;border-radius:6px}
        .oc-pay-cod{background:#fff8e1;color:#b86a00;border:1px solid #ffe082}
        .oc-pay-online{background:#e8f5e9;color:#2e7d32;border:1px solid #c8e6c9}
        .oc-timeline{display:flex;align-items:flex-start;gap:0;margin:12px 0;padding:12px 0;border-bottom:1px solid #f5f0e8}
        .otl-step{display:flex;flex-direction:column;align-items:center;flex:1;position:relative}
        .otl-dot{width:12px;height:12px;border-radius:50%;background:#ddd;border:2px solid #ddd;position:relative;z-index:1;flex-shrink:0}
        .otl-step.done .otl-dot{background:#2e7d32;border-color:#2e7d32}
        .otl-step.current .otl-dot{background:#fff;border-color:#2e7d32;box-shadow:0 0 0 3px rgba(46,125,50,.2)}
        .otl-line{position:absolute;top:5px;left:50%;width:100%;height:2px;background:#ddd;z-index:0}
        .otl-step.done .otl-line{background:#2e7d32}
        .otl-lbl{font-size:10px;font-weight:600;color:#aaa;margin-top:6px;text-align:center;white-space:nowrap}
        .otl-step.done .otl-lbl,.otl-step.current .otl-lbl{color:#2e7d32}
        .oc-items-row{margin-bottom:12px}
        .oc-imgs{display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap}
        .oc-img-box{width:56px;height:56px;border-radius:10px;border:1.5px solid #ede9e3;overflow:hidden;background:#f5f0e8;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .oc-img-more{width:56px;height:56px;border-radius:10px;background:#f5f0e8;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#888;border:1.5px solid #ede9e3}
        .oc-items-names{font-size:13px;color:#666;line-height:1.5}
        .oc-status-msg{font-size:12px;font-weight:600;color:#2e7d32;margin-bottom:10px;background:#f0faf0;padding:7px 12px;border-radius:8px;display:inline-block}
        .track-chip{display:inline-flex;align-items:center;gap:6px;background:#1a3a1e;color:#fff;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;margin-bottom:12px;transition:background .2s}
        .track-chip:hover{background:#2d5233}
        .oc-actions{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid #f0ece6}
        .oc-actions-left{display:flex;gap:8px;flex-wrap:wrap}
        .action-btn{display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:9px;font-size:12px;font-weight:600;cursor:pointer;transition:all .2s;text-decoration:none;border:1.5px solid transparent}
        .action-view{background:#f0f7f4;color:#1a3a1e;border-color:#c8e6c9}.action-view:hover{background:#1a3a1e;color:#fff;border-color:#1a3a1e}
        .action-invoice{background:#fafafa;color:#555;border-color:#e0e0e0}.action-invoice:hover{background:#555;color:#fff;border-color:#555}
        .action-return{background:#fff8e1;color:#b86a00;border-color:#ffe082}.action-return:hover{background:#b86a00;color:#fff;border-color:#b86a00}
        .action-support{background:#e8f5e9;color:#1a7a3a;border-color:#c8e6c9}.action-support:hover{background:#1a7a3a;color:#fff;border-color:#1a7a3a}

        /* Addresses */
        .addr-card{border:1.5px solid #ede9e3;border-radius:14px;padding:18px;margin-bottom:12px}
        .addr-default{border-color:#a5d6a7;background:#f6fbf6}
        .addr-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
        .addr-label{font-weight:700;font-size:13px;color:#1a3a1e}
        .addr-tag{background:#e8f5e9;color:#1b5e20;font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;text-transform:uppercase;letter-spacing:.5px}
        .addr-line{font-size:13px;color:#555;line-height:1.8}
        .addr-actions{display:flex;gap:8px;margin-top:12px}
        .addr-btn{padding:7px 16px;border-radius:9px;font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid #c8e6c9;color:#1a3a1e;background:#fff;transition:all .2s}
        .addr-btn:hover{background:#1a3a1e;color:#fff;border-color:#1a3a1e}
        .addr-del{border-color:#ffcdd2;color:#c0392b}.addr-del:hover{background:#c0392b;color:#fff;border-color:#c0392b}
        .add-addr-btn{display:flex;align-items:center;gap:8px;width:100%;padding:14px 18px;border:2px dashed #c8e6c9;border-radius:14px;background:#f6fbf6;color:#2e7d32;font-size:14px;font-weight:700;cursor:pointer;transition:all .2s;margin-top:4px}
        .add-addr-btn:hover{border-color:#1a3a1e;background:#f0f7f4;color:#1a3a1e}
        .addr-add-form{border:1.5px solid #c8e6c9;border-radius:16px;padding:20px;background:#f6fbf6;margin-top:8px}
        .addr-add-title{font-size:14px;font-weight:700;color:#1a3a1e;margin-bottom:18px}

        /* Forms */
        .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}
        .form-full{grid-column:1/-1}
        @media(max-width:500px){.form-grid{grid-template-columns:1fr}}
        .form-actions{display:flex;align-items:center;gap:14px}
        .f-lbl{font-size:11px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px}
        .f-inp{width:100%;padding:12px 14px;border:1.5px solid #e8e3db;border-radius:11px;font-size:14px;color:#1a1a1a;transition:border-color .2s,box-shadow .2s;outline:none;background:#fafaf8}
        .f-inp:focus{border-color:#1a3a1e;background:#fff;box-shadow:0 0 0 3px rgba(26,58,30,.08)}
        .f-err{border-color:#e74c3c!important;background:#fff9f9}
        .f-disabled{opacity:.55;cursor:not-allowed;background:#f5f5f5!important}
        .f-hint{font-size:11px;color:#bbb;margin-top:5px}
        .err-txt{font-size:11px;color:#e74c3c;margin-top:5px;font-weight:600}
        .save-msg{font-size:13px;color:#2d6a4f;font-weight:600}
        .phone-prefix{padding:12px 13px;background:#f5f0e8;border-radius:11px;font-size:14px;font-weight:700;color:#666;flex-shrink:0;border:1.5px solid #e8e3db}
        .pw-wrap{position:relative}.pw-wrap .f-inp{padding-right:44px}
        .pw-eye{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:16px;padding:2px}
        .pw-strength{display:flex;align-items:center;gap:10px;margin-top:8px}
        .pw-bar{height:4px;border-radius:4px;flex:1;transition:all .3s}
        .pw-weak{background:#ef5350;width:33%}.pw-medium{background:#ffa726;width:66%}.pw-strong{background:#43a047;width:100%}
        .pw-strength-lbl{font-size:11px;font-weight:700;color:#888}
        .match-msg{font-size:12px;color:#2e7d32;font-weight:600;margin-top:5px}

        /* Buttons */
        .btn-primary{background:linear-gradient(135deg,#1a3a1e,#2d5233);color:#fff;border:none;padding:12px 26px;border-radius:11px;font-size:14px;font-weight:700;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
        .btn-primary:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 5px 18px rgba(26,58,30,.28)}
        .btn-primary:disabled{opacity:.6;cursor:not-allowed}
        .btn-secondary{background:#fff;color:#1a3a1e;border:1.5px solid #c8e6c9;padding:11px 22px;border-radius:11px;font-size:14px;font-weight:600;cursor:pointer;transition:all .2s}
        .btn-secondary:hover{background:#f0f7f4}

        /* Empty */
        .empty-state{text-align:center;padding:52px 20px}
        .empty-icon{font-size:52px;margin-bottom:16px}
        .empty-title{font-size:22px;color:#1a3a1e;margin-bottom:8px;font-weight:700}
        .empty-sub{font-size:14px;color:#999;margin-bottom:24px;line-height:1.6}

        /* Login wall */
        .login-wall{max-width:440px;margin:80px auto;background:#fff;border-radius:24px;padding:52px 36px;text-align:center;box-shadow:0 4px 32px rgba(0,0,0,.07);border:1px solid #ede9e3}
        .lw-icon{font-size:52px;margin-bottom:16px}
        .lw-title{font-size:28px;color:#1a3a1e;margin-bottom:10px;font-weight:900}
        .lw-sub{font-size:14px;color:#999;margin-bottom:28px;line-height:1.7}

        /* Loading */
        .acc-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#f4f0eb;gap:16px}
        .loading-text{color:#aaa;font-size:14px}
        .acc-spinner{width:28px;height:28px;border:2.5px solid #e8e3db;border-top-color:#1a3a1e;border-radius:50%;animation:acc-spin 1s linear infinite}
        @keyframes acc-spin{to{transform:rotate(360deg)}}

        /* Mobile tabs */
        .mob-tabs{display:none}
        @media(max-width:900px){
          .mob-tabs{display:flex;position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #ede9e3;z-index:100;box-shadow:0 -2px 20px rgba(0,0,0,.08)}
          .mob-tab{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px 4px;border:none;background:none;cursor:pointer;font-size:9px;font-weight:700;color:#bbb;gap:3px;transition:color .2s}
          .mob-tab.active{color:#1a3a1e}
          .mt-icon{font-size:19px}
        }

        /* Toast */
        .acc-toast{position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#1a3a1e;color:#fff;padding:11px 22px;border-radius:12px;font-size:13px;font-weight:600;z-index:9999;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,.18);animation:toast-in .25s ease}
        .acc-toast-error{background:#c0392b}
        @keyframes toast-in{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        @media(max-width:768px){.acc-toast{bottom:72px;font-size:12px;max-width:88vw;white-space:normal;text-align:center}}
    `}</style>
  )
}

export default function AccountPage() {
  const [tab, setTab] = useState<Tab>('orders')

  const { toast, toastType, show: showToast } = useToast()
  const { openAuth } = useUIStore()
  const auth    = useAuth()
  const orders  = useOrders()
  const profile = useProfile(auth.profile, auth.updateLocalProfile, showToast)

  // ── savedAddrs: memoized from profile's saved_addresses string ──
  // The raw saved_addresses field is a JSON string — it changes by reference
  // only when the profile is updated, making it a stable, cheap dep.
  const savedAddrsRaw = auth.profile?.saved_addresses ?? ''
  const savedAddrs = useMemo(
    () => getSavedAddresses(auth.profile) as SavedAddress[],
    [savedAddrsRaw]
  )
  const savedAddrsList = useMemo(
    () => savedAddrs.filter(a => a.label !== 'Default'),
    [savedAddrs]
  )

  // ── Auth init — decoupled from mounted state ──────────────
  useEffect(() => {
    auth.init()
  }, []) // initDone.current inside init() prevents double-call

  // ── Populate profile form when profile loads ──────────────
  useEffect(() => {
    if (auth.profile) profile.initFromProfile(auth.profile)
  }, [auth.profile]) // profile.initFromProfile is stable (defined in hook body)

  // ── Auto-fetch orders when logged in ─────────────────────
  useEffect(() => {
    if (auth.loggedIn && !orders.hasFetched && !orders.loading) {
      orders.fetchOrders()
    }
  }, [auth.loggedIn, orders.hasFetched, orders.loading, orders.fetchOrders])

  // ── Auth loading state (replaces mounted gate) ────────────
  if (!auth.loaded) return (
    <>
      <AccountStyles />
      <div className="acc-loading">
        <div className="acc-spinner" />
        <p className="loading-text">Loading your account…</p>
      </div>
    </>
  )

  // ── Not logged in ─────────────────────────────────────────
  if (!auth.loggedIn) return (
    <>
      <AccountStyles />
      <div className="acc-wrap">
        <div className="login-wall">
          <div className="lw-icon">🔐</div>
          <div className="lw-title">Welcome Back</div>
          <p className="lw-sub">Please login to view your orders and manage your account.</p>
          <button className="btn-primary" onClick={openAuth}>Sign In to Continue</button>
        </div>
      </div>
    </>
  )

  // ─────────────────────────────────────────────────────────
  return (
    <div className="acc-wrap">
      <div className="acc-page">

        {/* ── SIDEBAR ── */}
        <Sidebar
          tab={tab}
          setTab={setTab}
          profile={auth.profile}
          authUser={auth.authUser}
          stats={orders.stats}
          onLogout={auth.logout}
          onOrdersClick={() => {
            if (!orders.hasFetched && !orders.loading) orders.fetchOrders()
          }}
        />

        {/* ── MAIN PANEL ── */}
        <div className="main-panel">

          {/* ══ ORDERS ══════════════════════════════════════ */}
          {tab === 'orders' && (
            <ErrorBoundary section="Orders">
            <div className="panel-section">
              <div className="panel-header">
                <div className="panel-title">My Orders</div>
                {orders.stats && <div className="panel-count">{orders.stats.total} orders</div>}
              </div>

              {/* Summary strip */}
              {orders.stats && orders.stats.total > 0 && (
                <div className="order-summary-strip">
                  {[
                    { n: orders.stats.delivered, l: 'Delivered',   cls: 'oss-delivered' },
                    { n: orders.stats.active,    l: 'In Transit',  cls: 'oss-active'    },
                    { n: orders.stats.cancelled, l: 'Cancelled',   cls: 'oss-cancelled' },
                    { n: orders.stats.spent,     l: 'Total Spent', cls: 'oss-spent', fmt: true },
                  ].map(({ n, l, cls, fmt }) => (
                    <div key={l} className={`oss-item ${cls}`}>
                      <span className="oss-num">{fmt ? formatCurrency(n) : n}</span>
                      <span className="oss-lbl">{l}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="card">
                {(orders.loading || orders.orders === null) ? <OrdersSkeleton /> : (
                  <>
                    {/* Toolbar */}
                    <div className="orders-toolbar">
                      <div className="search-wrap">
                        <span className="search-icon">🔍</span>
                        <input
                          className="orders-search"
                          type="text"
                          placeholder="Search by order # or product…"
                          value={orders.search}
                          onChange={e => orders.setSearch(e.target.value)}
                        />
                        {orders.search && (
                          <button type="button" className="search-clear" onClick={() => orders.setSearch('')}>✕</button>
                        )}
                      </div>
                      <div className="filter-row">
                        {([
                          { key: 'all'       as const, label: 'All'       },
                          { key: 'active'    as const, label: 'Active'    },
                          { key: 'delivered' as const, label: 'Delivered' },
                          { key: 'returns'   as const, label: 'Returns'   },
                          { key: 'cancelled' as const, label: 'Cancelled' },
                        ] as const).map(f => (
                          <button
                            key={f.key}
                            className={`filter-btn${orders.filter === f.key ? ' active' : ''}`}
                            onClick={() => orders.setFilter(f.key)}
                          >{f.label}</button>
                        ))}
                      </div>
                    </div>

                    {/* Order list — typed, no `any` */}
                    {orders.filtered.length === 0 ? (
                      <div className="empty-state">
                        <div className="empty-icon">{orders.orders.length === 0 ? '🛍️' : '🔍'}</div>
                        <div className="empty-title">{orders.orders.length === 0 ? 'No orders yet' : 'Nothing found'}</div>
                        <p className="empty-sub">
                          {orders.orders.length === 0
                            ? 'Discover our Himalayan natural products.'
                            : 'Try adjusting your search or filter.'}
                        </p>
                        {orders.orders.length === 0 && <Link href="/products" className="btn-primary">Shop Now →</Link>}
                        {orders.orders.length > 0 && (
                          <button className="btn-secondary" onClick={() => { orders.setFilter('all'); orders.setSearch('') }}>
                            Clear Filters
                          </button>
                        )}
                      </div>
                    ) : orders.filtered.map((o: Order) => (
                      <OrderCard
                        key={o.id}
                        order={o}
                        canReturn={orders.canReturn}
                        onReturnClick={(num: string) => showToast(`To return order ${num}, please contact support.`)}
                      />
                    ))}
                  </>
                )}
              </div>
            </div>
            </ErrorBoundary>
          )}

          {/* ══ ADDRESSES ════════════════════════════════════ */}
          {tab === 'addresses' && (
            <ErrorBoundary section="Addresses">
            <div className="panel-section">
              <div className="panel-header">
                <div className="panel-title">Delivery Addresses</div>
              </div>
              <div className="card">
                {/* Default address from profile */}
                {auth.profile?.address_line1 && (
                  <div className="addr-card addr-default">
                    <div className="addr-header">
                      <div className="addr-label">🏠 Default Address</div>
                      <div className="addr-tag">Primary</div>
                    </div>
                    <div className="addr-line">
                      <strong>{[auth.profile?.first_name, auth.profile?.last_name].filter(Boolean).join(' ')}</strong><br />
                      {[auth.profile?.address_line1, auth.profile?.city, auth.profile?.state, auth.profile?.postal_code].filter(Boolean).join(', ')}
                      {auth.profile?.phone && <><br /><span style={{ color: '#888' }}>{auth.profile.phone as string}</span></>}
                    </div>
                    <div className="addr-actions">
                      <button className="addr-btn" onClick={() => setTab('profile')}>✏️ Edit Address</button>
                    </div>
                  </div>
                )}

                {/* Saved addresses — stable key using id field */}
                {savedAddrsList.map((a: SavedAddress) => (
                  <div key={a.id || `${a.label}-${a.city}`} className="addr-card">
                    <div className="addr-header">
                      <div className="addr-label">📍 {a.label || 'Saved Address'}</div>
                    </div>
                    <div className="addr-line">
                      {a.name && <><strong>{a.name}</strong><br /></>}
                      {[a.addr, a.city, a.state, a.pin].filter(Boolean).join(', ')}
                    </div>
                    <div className="addr-actions">
                      <button className="addr-btn addr-del" onClick={() => profile.deleteAddress(a.label)}>
                        🗑 Remove
                      </button>
                    </div>
                  </div>
                ))}

                {/* Empty state */}
                {!auth.profile?.address_line1 && savedAddrs.length === 0 && !profile.showAddAddr && (
                  <div className="empty-state">
                    <div className="empty-icon">📍</div>
                    <div className="empty-title">No addresses saved</div>
                    <p className="empty-sub">Add a delivery address to checkout faster.</p>
                  </div>
                )}

                {/* Add address form / button */}
                {profile.showAddAddr ? (
                  <div className="addr-add-form">
                    <div className="addr-add-title">Add New Address</div>
                    <div className="form-grid">
                      <div>
                        <div className="f-lbl">Label *</div>
                        <select
                          className={`f-inp${profile.newAddrErr.label ? ' f-err' : ''}`}
                          value={profile.newAddr.label}
                          onChange={e => { profile.setNewAddr(a => ({ ...a, label: e.target.value })); profile.setNewAddrErr(er => ({ ...er, label: '' })) }}
                        >
                          <option value="">Select label…</option>
                          {ADDRESS_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                        {profile.newAddrErr.label && <div className="err-txt">{profile.newAddrErr.label}</div>}
                      </div>
                      <div>
                        <div className="f-lbl">Contact Name</div>
                        <input className="f-inp" value={profile.newAddr.name} onChange={e => profile.setNewAddr(a => ({ ...a, name: e.target.value }))} placeholder="Full name" />
                      </div>
                      <div className="form-full">
                        <div className="f-lbl">Street / Flat / Colony *</div>
                        <input className={`f-inp${profile.newAddrErr.flat ? ' f-err' : ''}`} value={profile.newAddr.flat} onChange={e => { profile.setNewAddr(a => ({ ...a, flat: e.target.value })); profile.setNewAddrErr(er => ({ ...er, flat: '' })) }} placeholder="House no., Street, Colony" />
                        {profile.newAddrErr.flat && <div className="err-txt">{profile.newAddrErr.flat}</div>}
                      </div>
                      <div>
                        <div className="f-lbl">City *</div>
                        <input className={`f-inp${profile.newAddrErr.city ? ' f-err' : ''}`} value={profile.newAddr.city} onChange={e => { profile.setNewAddr(a => ({ ...a, city: e.target.value })); profile.setNewAddrErr(er => ({ ...er, city: '' })) }} placeholder="City" />
                        {profile.newAddrErr.city && <div className="err-txt">{profile.newAddrErr.city}</div>}
                      </div>
                      <div>
                        <div className="f-lbl">State *</div>
                        <select className={`f-inp${profile.newAddrErr.state ? ' f-err' : ''}`} value={profile.newAddr.state} onChange={e => { profile.setNewAddr(a => ({ ...a, state: e.target.value })); profile.setNewAddrErr(er => ({ ...er, state: '' })) }}>
                          <option value="">Select State / UT</option>
                          {INDIA_STATES.map(s => <option key={s}>{s}</option>)}
                        </select>
                        {profile.newAddrErr.state && <div className="err-txt">{profile.newAddrErr.state}</div>}
                      </div>
                      <div>
                        <div className="f-lbl">Pincode</div>
                        <input className={`f-inp${profile.newAddrErr.pin ? ' f-err' : ''}`} value={profile.newAddr.pin} onChange={e => { profile.setNewAddr(a => ({ ...a, pin: e.target.value.replace(/\D/g, '') })); profile.setNewAddrErr(er => ({ ...er, pin: '' })) }} placeholder="110001" maxLength={6} inputMode="numeric" />
                        {profile.newAddrErr.pin && <div className="err-txt">{profile.newAddrErr.pin}</div>}
                      </div>
                    </div>
                    <div className="form-actions">
                      <button className="btn-primary" onClick={profile.saveNewAddress} disabled={!!profile.busy.newAddr}>
                        {profile.busy.newAddr ? 'Saving…' : 'Save Address'}
                      </button>
                      <button className="btn-secondary" onClick={() => { profile.setShowAddAddr(false); profile.setNewAddrErr({}) }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="add-addr-btn" onClick={() => profile.setShowAddAddr(true)}>
                    <span style={{ fontSize: '18px', lineHeight: 1 }}>+</span> Add New Address
                  </button>
                )}
              </div>
            </div>
            </ErrorBoundary>
          )}

          {/* ══ PROFILE ══════════════════════════════════════ */}
          {tab === 'profile' && (
            <ErrorBoundary section="Profile">
            <div className="panel-section">
              <div className="panel-header">
                <div className="panel-title">My Profile</div>
              </div>

              {/* Name */}
              <div className="card">
                <div className="card-section-title">Personal Information</div>
                <div className="form-grid">
                  <div>
                    <div className="f-lbl">First Name *</div>
                    <input className={`f-inp${profile.pfErr.fname ? ' f-err' : ''}`} value={profile.pf.fname} onChange={e => { profile.setPf(p => ({ ...p, fname: e.target.value })); profile.setPfErr(er => ({ ...er, fname: '' })) }} placeholder="First name" />
                    {profile.pfErr.fname && <div className="err-txt">{profile.pfErr.fname}</div>}
                  </div>
                  <div>
                    <div className="f-lbl">Last Name</div>
                    <input className="f-inp" value={profile.pf.lname} onChange={e => profile.setPf(p => ({ ...p, lname: e.target.value }))} placeholder="Last name" />
                  </div>
                </div>
                <div className="form-actions">
                  <button className="btn-primary" onClick={profile.saveName} disabled={!!profile.busy.name}>
                    {profile.busy.name ? 'Saving…' : 'Save Name'}
                  </button>
                  {profile.msg.name && <div className="save-msg">{profile.msg.name}</div>}
                </div>
              </div>

              {/* Address */}
              <div className="card">
                <div className="card-section-title">Default Delivery Address</div>
                <div className="form-grid">
                  <div className="form-full">
                    <div className="f-lbl">Street / Flat / Colony *</div>
                    <input className={`f-inp${profile.pfErr.addr ? ' f-err' : ''}`} value={profile.pf.addr} onChange={e => { profile.setPf(p => ({ ...p, addr: e.target.value })); profile.setPfErr(er => ({ ...er, addr: '' })) }} placeholder="House no., Street, Colony" />
                    {profile.pfErr.addr && <div className="err-txt">{profile.pfErr.addr}</div>}
                  </div>
                  <div>
                    <div className="f-lbl">City *</div>
                    <input className={`f-inp${profile.pfErr.city ? ' f-err' : ''}`} value={profile.pf.city} onChange={e => { profile.setPf(p => ({ ...p, city: e.target.value })); profile.setPfErr(er => ({ ...er, city: '' })) }} placeholder="City" />
                    {profile.pfErr.city && <div className="err-txt">{profile.pfErr.city}</div>}
                  </div>
                  <div>
                    <div className="f-lbl">State *</div>
                    <select className={`f-inp${profile.pfErr.state ? ' f-err' : ''}`} value={profile.pf.state} onChange={e => { profile.setPf(p => ({ ...p, state: e.target.value })); profile.setPfErr(er => ({ ...er, state: '' })) }}>
                      <option value="">Select State / UT</option>
                      {INDIA_STATES.map(s => <option key={s}>{s}</option>)}
                    </select>
                    {profile.pfErr.state && <div className="err-txt">{profile.pfErr.state}</div>}
                  </div>
                  <div>
                    <div className="f-lbl">Pincode *</div>
                    <input className={`f-inp${profile.pfErr.pin ? ' f-err' : ''}`} value={profile.pf.pin} onChange={e => { profile.setPf(p => ({ ...p, pin: e.target.value.replace(/\D/g, '') })); profile.setPfErr(er => ({ ...er, pin: '' })) }} placeholder="110001" maxLength={6} inputMode="numeric" />
                    {profile.pfErr.pin && <div className="err-txt">{profile.pfErr.pin}</div>}
                  </div>
                </div>
                <div className="form-actions">
                  <button className="btn-primary" onClick={profile.saveAddress} disabled={!!profile.busy.addr}>
                    {profile.busy.addr ? 'Saving…' : 'Save Address'}
                  </button>
                  {profile.msg.addr && <div className="save-msg">{profile.msg.addr}</div>}
                </div>
              </div>

              {/* Contact */}
              <div className="card">
                <div className="card-section-title">Contact Information</div>
                <div className="form-grid">
                  <div>
                    <div className="f-lbl">Phone Number</div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span className="phone-prefix">+91</span>
                      <input className={`f-inp${profile.pfErr.phone ? ' f-err' : ''}`} style={{ flex: 1 }} value={profile.pf.phone} onChange={e => { profile.setPf(p => ({ ...p, phone: e.target.value.replace(/\D/g, '') })); profile.setPfErr(er => ({ ...er, phone: '' })) }} placeholder="10-digit mobile" maxLength={10} inputMode="numeric" />
                    </div>
                    {profile.pfErr.phone && <div className="err-txt">{profile.pfErr.phone}</div>}
                  </div>
                  <div>
                    <div className="f-lbl">Email Address</div>
                    <input className="f-inp f-disabled" value={String(auth.authUser?.email || auth.profile?.email || '')} disabled />
                    <div className="f-hint">Email cannot be changed</div>
                  </div>
                </div>
                <div className="form-actions">
                  <button className="btn-primary" onClick={profile.savePhone} disabled={!!profile.busy.phone}>
                    {profile.busy.phone ? 'Saving…' : 'Save Phone'}
                  </button>
                  {profile.msg.phone && <div className="save-msg">{profile.msg.phone}</div>}
                </div>
              </div>
            </div>
            </ErrorBoundary>
          )}

          {/* ══ PASSWORD ═════════════════════════════════════ */}
          {tab === 'password' && (
            <ErrorBoundary section="Password">
            <div className="panel-section">
              <div className="panel-header">
                <div className="panel-title">Change Password</div>
              </div>
              <div className="card">
                <div className="card-section-title">Set New Password</div>
                <div className="form-grid" style={{ maxWidth: '480px' }}>
                  <div className="form-full">
                    <div className="f-lbl">Current Password *</div>
                    <div className="pw-wrap">
                      <input className={`f-inp${profile.pfErr.curp ? ' f-err' : ''}`} type={profile.pw.showCur ? 'text' : 'password'} value={profile.pw.curp} onChange={e => { profile.setPw(p => ({ ...p, curp: e.target.value })); profile.setPfErr(er => ({ ...er, curp: '' })) }} placeholder="Your current password" />
                      <button type="button" className="pw-eye" onClick={() => profile.setPw(p => ({ ...p, showCur: !p.showCur }))}>{profile.pw.showCur ? '🙈' : '👁'}</button>
                    </div>
                    {profile.pfErr.curp && <div className="err-txt">{profile.pfErr.curp}</div>}
                  </div>
                  <div className="form-full">
                    <div className="f-lbl">New Password *</div>
                    <div className="pw-wrap">
                      <input className={`f-inp${profile.pfErr.newp ? ' f-err' : ''}`} type={profile.pw.showNew ? 'text' : 'password'} value={profile.pw.newp} onChange={e => { profile.setPw(p => ({ ...p, newp: e.target.value })); profile.setPfErr(er => ({ ...er, newp: '' })) }} placeholder="Minimum 6 characters" />
                      <button type="button" className="pw-eye" onClick={() => profile.setPw(p => ({ ...p, showNew: !p.showNew }))}>{profile.pw.showNew ? '🙈' : '👁'}</button>
                    </div>
                    {profile.pfErr.newp && <div className="err-txt">{profile.pfErr.newp}</div>}
                    {profile.pw.newp.length > 0 && (
                      <div className="pw-strength">
                        <div className={`pw-bar ${profile.pw.newp.length >= 8 ? 'pw-strong' : profile.pw.newp.length >= 6 ? 'pw-medium' : 'pw-weak'}`} />
                        <span className="pw-strength-lbl">{profile.pw.newp.length >= 8 ? 'Strong' : profile.pw.newp.length >= 6 ? 'Medium' : 'Weak'}</span>
                      </div>
                    )}
                  </div>
                  <div className="form-full">
                    <div className="f-lbl">Confirm Password *</div>
                    <div className="pw-wrap">
                      <input className={`f-inp${profile.pfErr.conf ? ' f-err' : ''}`} type={profile.pw.showConf ? 'text' : 'password'} value={profile.pw.conf} onChange={e => { profile.setPw(p => ({ ...p, conf: e.target.value })); profile.setPfErr(er => ({ ...er, conf: '' })) }} placeholder="Repeat new password" />
                      <button type="button" className="pw-eye" onClick={() => profile.setPw(p => ({ ...p, showConf: !p.showConf }))}>{profile.pw.showConf ? '🙈' : '👁'}</button>
                    </div>
                    {profile.pfErr.conf && <div className="err-txt">{profile.pfErr.conf}</div>}
                    {profile.pw.conf.length > 0 && profile.pw.newp === profile.pw.conf && <div className="match-msg">✅ Passwords match</div>}
                  </div>
                </div>
                <div className="form-actions">
                  <button className="btn-primary" onClick={profile.changePassword} disabled={!!profile.busy.pw}>
                    {profile.busy.pw ? 'Updating…' : 'Update Password'}
                  </button>
                </div>
              </div>
            </div>
            </ErrorBoundary>
          )}

        </div>{/* main-panel */}
      </div>{/* acc-page */}

      {/* Mobile nav */}
      <div className="mob-tabs">
        {([
          { key: 'orders',    icon: '📦', label: 'Orders'    },
          { key: 'addresses', icon: '📍', label: 'Addresses' },
          { key: 'profile',   icon: '👤', label: 'Profile'   },
          { key: 'password',  icon: '🔒', label: 'Password'  },
        ] as const).map(it => (
          <button key={it.key} className={`mob-tab${tab === it.key ? ' active' : ''}`} onClick={() => { setTab(it.key); if (it.key === 'orders' && !orders.hasFetched && !orders.loading) orders.fetchOrders() }}>
            <span className="mt-icon">{it.icon}</span>{it.label}
          </button>
        ))}
        <button className="mob-tab" onClick={auth.logout}><span className="mt-icon">🚪</span>Logout</button>
      </div>

      {/* Toast */}
      {toast && <div className={`acc-toast${toastType === 'error' ? ' acc-toast-error' : ''}`}>{toast}</div>}

      <AccountStyles />
    </div>
  )
}
