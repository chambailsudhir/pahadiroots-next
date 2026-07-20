'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'
import type { SiteSettings } from '@/types'

interface Props { settings: SiteSettings }

export default function Footer({ settings }: Props) {
  const [email, setEmail] = useState('')
  const [subDone, setSubDone] = useState(false)
  const [subLoading, setSubLoading] = useState(false)

  async function handleSub(e: React.FormEvent) {
    e.preventDefault()
    if (!email.includes('@')) return
    setSubLoading(true)
    try {
      await fetch('/api/v1/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'subscribe', email }),
      })
    } catch (e: unknown) {
      // BUG FIX [ERROR HANDLING]: previously bare `catch {}` — completely silent.
      // Newsletter subscription failures were invisible to ops.
      console.error('[Footer] newsletter subscribe failed:', e)
    }
    setSubDone(true)
    setSubLoading(false)
  }

  // BUG FIX (confirmed against the pahadi-admin repo directly): this was
  // reading instagram_url/facebook_url/youtube_url — but the admin panel's
  // Social settings section (src/app/admin/settings/page.jsx) actually
  // writes to social_instagram/social_facebook/social_youtube/
  // social_twitter/social_pinterest. Completely disjoint key names — every
  // social link an admin ever entered in that panel had zero effect on the
  // live site. X/Twitter was also fully hardcoded here (not settings-driven
  // at all), and Pinterest wasn't rendered anywhere despite the admin
  // panel already having a field for it.
  const instagramUrl = settings.social_instagram || 'https://www.instagram.com/5pahadiroots/?hl=en'
  const facebookUrl  = settings.social_facebook  || 'https://www.facebook.com/pahadiroots'
  const youtubeUrl   = settings.social_youtube   || 'https://www.youtube.com/@pahadiroots'
  const twitterUrl   = settings.social_twitter   || 'https://twitter.com/pahadiroots'
  // No fabricated fallback for Pinterest — the admin panel has no default
  // for it either, so the icon only renders once a real URL is actually set.
  const pinterestUrl = settings.social_pinterest || ''
  // LinkedIn has no admin-panel counterpart at all (not managed there under
  // any key name) — kept as a plain settings-overridable constant since
  // there's nothing on the admin side to wire this to yet.
  const linkedinUrl  = settings.linkedin_url  || 'https://www.linkedin.com/company/pahadiroots/about/?viewAsMember=true'
  const phone        = settings.contact_phone  || '+919899984895'
  const email2       = settings.contact_email  || 'hello@pahadiroots.com'
  const address      = settings.contact_address || 'Village Sakoh, PO Sakoh, Distt Kangra, Himachal Pradesh 176082'

  return (
    <footer style={{ background: '#0f2a14', fontFamily: 'Lato,sans-serif' }}>

      {/* ── Newsletter strip ─────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(180deg,#0f2a14 0%,#1a3a1e 100%)',
        borderTop: '2px solid #c8920a', borderBottom: '2px solid rgba(200,146,10,.2)',
        boxShadow: '0 -6px 32px rgba(0,0,0,.18),inset 0 1px 0 rgba(200,146,10,.15)',
        padding: '32px 40px 36px',
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px', flexWrap: 'wrap' }}>
          <div>
            <h4 style={{ fontFamily: '"Playfair Display",serif', fontSize: '18px', fontWeight: 900, color: '#fff', marginBottom: '4px', margin: '0 0 4px' }}>
              🌿 Join the Pahadi Family
            </h4>
            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,.55)', margin: 0 }}>
              New arrivals &amp; Himalayan stories, straight to your inbox
            </p>
          </div>
          {subDone ? (
            <div style={{ color: '#c8920a', fontWeight: 700, fontSize: '14px' }}>🎉 Check your inbox for your 5% off code!</div>
          ) : (
            <form onSubmit={handleSub} style={{ display: 'flex', borderRadius: '10px', overflow: 'hidden', border: '1.5px solid rgba(255,255,255,.18)', minWidth: '300px' }}>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="Enter your email address" required autoComplete="email"
                style={{ flex: 1, padding: '12px 16px', background: 'rgba(255,255,255,.07)', border: 'none', color: '#fff', fontSize: '13px', outline: 'none' }}
              />
              <button type="submit" aria-label="Subscribe to newsletter" disabled={subLoading} style={{
                padding: '12px 20px', background: '#c8920a', color: '#1a0800',
                fontWeight: 800, fontSize: '13px', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              }}>Subscribe</button>
            </form>
          )}
        </div>
      </div>

      {/* ── Himachali Chamba Rumal frieze (dancer band) ──── */}
      <div style={{ background: '#1a0d2e', borderTop: '2px solid #c8920a', borderBottom: '2px solid #c8920a', lineHeight: 0, overflow: 'hidden' }}>
        <svg width="100%" viewBox="0 0 1440 68" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
          <rect width="1440" height="68" fill="#1a0d2e"/>
          <line x1="0" y1="2.5" x2="1440" y2="2.5" stroke="#c8920a" strokeWidth="0.6" opacity="0.45"/>
          <line x1="0" y1="65.5" x2="1440" y2="65.5" stroke="#c8920a" strokeWidth="0.6" opacity="0.45"/>
          <defs>
            <g id="fu1">
              <g transform="translate(10,26)"><ellipse cx="0" cy="0" rx="7" ry="4" fill="#e87c3e" opacity=".9"/><circle cx="7" cy="-2" r="3" fill="#e87c3e"/><line x1="7" y1="-2" x2="13" y2="-6" stroke="#e87c3e" strokeWidth="1.2"/><polygon points="-8,2 -14,8 -5,6" fill="#c85020" opacity=".8"/></g>
              <g transform="translate(32,54)"><polygon points="0,0 -13,-7 -9,-18 0,-22 9,-18 13,-7" fill="#d4186c" opacity=".85"/><polygon points="0,0 -13,-7 -9,-18 0,-22" fill="#a0104a"/><polygon points="0,0 9,-18 13,-7" fill="#f050a0"/><rect x="-3.5" y="-29" width="7" height="9" rx="2" fill="#1e6bb0"/><circle cx="0" cy="-34" r="3.5" fill="#d4956a"/><path d="M-3.5,-31 Q-9,-27 -11,-22" stroke="#2d0a6e" strokeWidth="1.8" fill="none"/><line x1="-3.5" y1="-27" x2="-10" y2="-21" stroke="#d4956a" strokeWidth="1.3"/><line x1="3.5" y1="-27" x2="10" y2="-21" stroke="#d4956a" strokeWidth="1.3"/></g>
              <g transform="translate(56,54)"><polygon points="0,0 -9,-5 -5,-16 0,-14 5,-16 9,-5" fill="#f0a020" opacity=".85"/><polygon points="0,0 -9,-5 -5,-16 0,-14" fill="#b07010"/><polygon points="0,0 5,-16 9,-5" fill="#f8c050"/><rect x="-3.5" y="-23" width="7" height="8" rx="2" fill="#c8340c"/><circle cx="0" cy="-28" r="3.2" fill="#c8905a"/><line x1="-3.5" y1="-21" x2="-10" y2="-15" stroke="#c8905a" strokeWidth="1.3"/><line x1="3.5" y1="-21" x2="10" y2="-15" stroke="#c8905a" strokeWidth="1.3"/></g>
              <g transform="translate(79,24) scale(-1,1)"><ellipse cx="0" cy="0" rx="7" ry="4" fill="#56b848" opacity=".9"/><circle cx="7" cy="-2" r="3" fill="#56b848"/><polygon points="-8,2 -14,8 -5,6" fill="#2d8020" opacity=".8"/></g>
              <g transform="translate(98,34)"><circle cx="0" cy="0" r="4" fill="#c8920a"/><circle cx="0" cy="-7" r="2.5" fill="#e8b050"/><circle cx="7" cy="0" r="2.5" fill="#e8b050"/><circle cx="0" cy="7" r="2.5" fill="#e8b050"/><circle cx="-7" cy="0" r="2.5" fill="#e8b050"/></g>
            </g>
            <g id="fu2">
              <g transform="translate(10,26)"><ellipse cx="0" cy="0" rx="7" ry="4" fill="#c84090" opacity=".9"/><circle cx="7" cy="-2" r="3" fill="#c84090"/><polygon points="-8,2 -14,8 -5,6" fill="#902060" opacity=".8"/></g>
              <g transform="translate(32,54)"><polygon points="0,0 -13,-7 -9,-18 0,-22 9,-18 13,-7" fill="#1e6bb0" opacity=".85"/><polygon points="0,0 -13,-7 -9,-18 0,-22" fill="#154f8a"/><polygon points="0,0 9,-18 13,-7" fill="#3090d8"/><rect x="-3.5" y="-29" width="7" height="9" rx="2" fill="#d4186c"/><circle cx="0" cy="-34" r="3.5" fill="#d4956a"/><path d="M-3.5,-31 Q-9,-27 -11,-22" stroke="#8b0040" strokeWidth="1.8" fill="none"/><line x1="-3.5" y1="-27" x2="-10" y2="-21" stroke="#d4956a" strokeWidth="1.3"/><line x1="3.5" y1="-27" x2="10" y2="-21" stroke="#d4956a" strokeWidth="1.3"/></g>
              <g transform="translate(56,54)"><polygon points="0,0 -9,-5 -5,-16 0,-14 5,-16 9,-5" fill="#56b848" opacity=".85"/><polygon points="0,0 -9,-5 -5,-16 0,-14" fill="#2d8020"/><polygon points="0,0 5,-16 9,-5" fill="#78d060"/><rect x="-3.5" y="-23" width="7" height="8" rx="2" fill="#6a3090"/><circle cx="0" cy="-28" r="3.2" fill="#c8905a"/><line x1="-3.5" y1="-21" x2="-10" y2="-15" stroke="#c8905a" strokeWidth="1.3"/><line x1="3.5" y1="-21" x2="10" y2="-15" stroke="#c8905a" strokeWidth="1.3"/></g>
              <g transform="translate(79,24) scale(-1,1)"><ellipse cx="0" cy="0" rx="7" ry="4" fill="#e87c3e" opacity=".9"/><circle cx="7" cy="-2" r="3" fill="#e87c3e"/><polygon points="-8,2 -14,8 -5,6" fill="#d4522a" opacity=".8"/></g>
              <g transform="translate(98,34)"><circle cx="0" cy="0" r="4" fill="#d4186c"/><circle cx="0" cy="-7" r="2.5" fill="#f050a0"/><circle cx="7" cy="0" r="2.5" fill="#f050a0"/><circle cx="0" cy="7" r="2.5" fill="#f050a0"/><circle cx="-7" cy="0" r="2.5" fill="#f050a0"/></g>
            </g>
          </defs>
          <use href="#fu1" x="0"/><use href="#fu2" x="112"/><use href="#fu1" x="224"/><use href="#fu2" x="336"/>
          <use href="#fu1" x="448"/><use href="#fu2" x="560"/><use href="#fu1" x="672"/><use href="#fu2" x="784"/>
          <use href="#fu1" x="896"/><use href="#fu2" x="1008"/><use href="#fu1" x="1120"/><use href="#fu2" x="1232"/>
          <use href="#fu1" x="1344"/>
        </svg>
      </div>

      {/* ── Brand row ─────────────────────────────────────── */}
      <div className="ft-brand-row" style={{ display: 'flex', alignItems: 'center', gap: '32px', padding: '36px 60px 28px', width: '100%', boxSizing: 'border-box', background: '#0f2a14' }}>
        {/* Left vine panel */}
        <div style={{ flexShrink: 0, alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>
          <svg width="52" height="120" viewBox="0 0 52 120" xmlns="http://www.w3.org/2000/svg" style={{ transform: 'scaleX(-1)', display: 'block' }}>
            <line x1="26" y1="0" x2="26" y2="120" stroke="#c8920a" strokeWidth=".7" opacity=".25"/>
            <g transform="translate(26,14)"><circle cx="0" cy="0" r="5" fill="#d4186c" opacity=".8"/><circle cx="-8" cy="0" r="3" fill="#e87c3e" opacity=".65"/><circle cx="8" cy="0" r="3" fill="#e87c3e" opacity=".65"/><circle cx="0" cy="-8" r="3" fill="#56b848" opacity=".65"/></g>
            <g transform="translate(26,36)"><ellipse cx="0" cy="0" rx="6" ry="4" fill="#e87c3e" opacity=".75"/><circle cx="7" cy="-2" r="2" fill="#f0c030" opacity=".65"/><polygon points="-8,2 -12,7 -5,5" fill="#c8340c" opacity=".55"/></g>
            <g transform="translate(26,58)"><circle cx="0" cy="0" r="5" fill="#1e6bb0" opacity=".8"/><circle cx="-8" cy="0" r="3" fill="#c84090" opacity=".65"/><circle cx="8" cy="0" r="3" fill="#c84090" opacity=".65"/><circle cx="0" cy="8" r="3" fill="#56b848" opacity=".65"/></g>
            <g transform="translate(26,80)"><ellipse cx="0" cy="0" rx="6" ry="4" fill="#56b848" opacity=".75"/><circle cx="7" cy="-2" r="2" fill="#c8920a" opacity=".65"/><polygon points="-8,2 -12,7 -5,5" fill="#2d8020" opacity=".55"/></g>
            <g transform="translate(26,102)"><circle cx="0" cy="0" r="4" fill="#c8920a" opacity=".65"/><circle cx="-6" cy="0" r="2" fill="#e8b050" opacity=".5"/><circle cx="6" cy="0" r="2" fill="#e8b050" opacity=".5"/></g>
          </svg>
        </div>

        {/* Medallion */}
        <div style={{ flexShrink: 0, marginLeft: '20px' }}>
          <svg width="104" height="104" viewBox="0 0 110 110" xmlns="http://www.w3.org/2000/svg">
            <circle cx="55" cy="55" r="52" fill="none" stroke="#c8920a" strokeWidth="1.5" opacity=".6"/>
            <circle cx="55" cy="55" r="48" fill="#1a0400" opacity=".95"/>
            <g opacity=".7">
              <ellipse cx="55" cy="13" rx="5" ry="9" fill="#d4186c" transform="rotate(0 55 55)"/>
              <ellipse cx="55" cy="13" rx="5" ry="9" fill="#e87c3e" transform="rotate(45 55 55)"/>
              <ellipse cx="55" cy="13" rx="5" ry="9" fill="#1e6bb0" transform="rotate(90 55 55)"/>
              <ellipse cx="55" cy="13" rx="5" ry="9" fill="#56b848" transform="rotate(135 55 55)"/>
              <ellipse cx="55" cy="13" rx="5" ry="9" fill="#d4186c" transform="rotate(180 55 55)"/>
              <ellipse cx="55" cy="13" rx="5" ry="9" fill="#e87c3e" transform="rotate(225 55 55)"/>
              <ellipse cx="55" cy="13" rx="5" ry="9" fill="#1e6bb0" transform="rotate(270 55 55)"/>
              <ellipse cx="55" cy="13" rx="5" ry="9" fill="#56b848" transform="rotate(315 55 55)"/>
            </g>
            <g transform="translate(55,22)"><polygon points="0,6 -5,0 -3,-6 0,-8 3,-6 5,0" fill="#d4186c"/><rect x="-2.5" y="-13" width="5" height="5" rx="1" fill="#1e6bb0"/><circle cx="0" cy="-16" r="2.5" fill="#d4956a"/><line x1="-2.5" y1="-11" x2="-6" y2="-7" stroke="#d4956a" strokeWidth="1"/><line x1="2.5" y1="-11" x2="6" y2="-7" stroke="#d4956a" strokeWidth="1"/></g>
            <g transform="translate(55,22) rotate(45 0 33)"><polygon points="0,6 -5,0 -3,-6 0,-8 3,-6 5,0" fill="#f0a020"/><rect x="-2.5" y="-13" width="5" height="5" rx="1" fill="#c8340c"/><circle cx="0" cy="-16" r="2.5" fill="#c8905a"/><line x1="-2.5" y1="-11" x2="-6" y2="-7" stroke="#c8905a" strokeWidth="1"/><line x1="2.5" y1="-11" x2="6" y2="-7" stroke="#c8905a" strokeWidth="1"/></g>
            <g transform="translate(55,22) rotate(90 0 33)"><polygon points="0,6 -5,0 -3,-6 0,-8 3,-6 5,0" fill="#1e6bb0"/><rect x="-2.5" y="-13" width="5" height="5" rx="1" fill="#d4186c"/><circle cx="0" cy="-16" r="2.5" fill="#d4956a"/><line x1="-2.5" y1="-11" x2="-6" y2="-7" stroke="#d4956a" strokeWidth="1"/><line x1="2.5" y1="-11" x2="6" y2="-7" stroke="#d4956a" strokeWidth="1"/></g>
            <g transform="translate(55,22) rotate(135 0 33)"><polygon points="0,6 -5,0 -3,-6 0,-8 3,-6 5,0" fill="#56b848"/><rect x="-2.5" y="-13" width="5" height="5" rx="1" fill="#6a3090"/><circle cx="0" cy="-16" r="2.5" fill="#c8905a"/><line x1="-2.5" y1="-11" x2="-6" y2="-7" stroke="#c8905a" strokeWidth="1"/><line x1="2.5" y1="-11" x2="6" y2="-7" stroke="#c8905a" strokeWidth="1"/></g>
            <g transform="translate(55,22) rotate(180 0 33)"><polygon points="0,6 -5,0 -3,-6 0,-8 3,-6 5,0" fill="#d4186c"/><rect x="-2.5" y="-13" width="5" height="5" rx="1" fill="#1e6bb0"/><circle cx="0" cy="-16" r="2.5" fill="#d4956a"/><line x1="-2.5" y1="-11" x2="-6" y2="-7" stroke="#d4956a" strokeWidth="1"/><line x1="2.5" y1="-11" x2="6" y2="-7" stroke="#d4956a" strokeWidth="1"/></g>
            <g transform="translate(55,22) rotate(225 0 33)"><polygon points="0,6 -5,0 -3,-6 0,-8 3,-6 5,0" fill="#f0a020"/><rect x="-2.5" y="-13" width="5" height="5" rx="1" fill="#c8340c"/><circle cx="0" cy="-16" r="2.5" fill="#c8905a"/><line x1="-2.5" y1="-11" x2="-6" y2="-7" stroke="#c8905a" strokeWidth="1"/><line x1="2.5" y1="-11" x2="6" y2="-7" stroke="#c8905a" strokeWidth="1"/></g>
            <g transform="translate(55,22) rotate(270 0 33)"><polygon points="0,6 -5,0 -3,-6 0,-8 3,-6 5,0" fill="#1e6bb0"/><rect x="-2.5" y="-13" width="5" height="5" rx="1" fill="#d4186c"/><circle cx="0" cy="-16" r="2.5" fill="#d4956a"/><line x1="-2.5" y1="-11" x2="-6" y2="-7" stroke="#d4956a" strokeWidth="1"/><line x1="2.5" y1="-11" x2="6" y2="-7" stroke="#d4956a" strokeWidth="1"/></g>
            <g transform="translate(55,22) rotate(315 0 33)"><polygon points="0,6 -5,0 -3,-6 0,-8 3,-6 5,0" fill="#56b848"/><rect x="-2.5" y="-13" width="5" height="5" rx="1" fill="#6a3090"/><circle cx="0" cy="-16" r="2.5" fill="#c8905a"/><line x1="-2.5" y1="-11" x2="-6" y2="-7" stroke="#c8905a" strokeWidth="1"/><line x1="2.5" y1="-11" x2="6" y2="-7" stroke="#c8905a" strokeWidth="1"/></g>
            {[0,45,90,135,180,225,270,315].map(deg => (
              <circle key={deg} cx="55" cy="30" r="1.5" fill="#fff" opacity=".3" transform={`rotate(${deg + 22.5} 55 55)`}/>
            ))}
            <circle cx="55" cy="55" r="12" fill="#0b160d"/>
            <circle cx="55" cy="55" r="9" fill="none" stroke="#c8920a" strokeWidth="1.5"/>
            <line x1="55" y1="47" x2="55" y2="63" stroke="#c8920a" strokeWidth="1.5"/>
            <line x1="47" y1="55" x2="63" y2="55" stroke="#c8920a" strokeWidth="1.5"/>
            <circle cx="55" cy="55" r="3" fill="#c8920a"/>
          </svg>
        </div>

        {/* Brand text */}
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: '"Playfair Display",serif', fontSize: '26px', fontWeight: 900, color: '#fff', lineHeight: 1.1, marginBottom: '4px' }}>
            HimVeda by Pahadi Roots
          </div>
          <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '2px', color: '#c8920a', textTransform: 'uppercase', marginBottom: '12px' }}>
            Himalayan Natural Store
          </div>
          <p style={{ fontSize: '13px', color: 'rgba(255,255,255,.48)', lineHeight: 1.8, margin: 0, maxWidth: '480px' }}>
            Born in the mountains, delivered to your doorstep. Pure Himalayan natural products,
            sourced with love from farming communities across 10 Himalayan states.
          </p>
        </div>

        {/* Right vine panel */}
        <div style={{ flexShrink: 0, alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>
          <svg width="52" height="120" viewBox="0 0 52 120" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
            <line x1="26" y1="0" x2="26" y2="120" stroke="#c8920a" strokeWidth=".7" opacity=".25"/>
            <g transform="translate(26,14)"><circle cx="0" cy="0" r="5" fill="#d4186c" opacity=".8"/><circle cx="-8" cy="0" r="3" fill="#e87c3e" opacity=".65"/><circle cx="8" cy="0" r="3" fill="#e87c3e" opacity=".65"/><circle cx="0" cy="-8" r="3" fill="#56b848" opacity=".65"/></g>
            <g transform="translate(26,36)"><ellipse cx="0" cy="0" rx="6" ry="4" fill="#e87c3e" opacity=".75"/><circle cx="7" cy="-2" r="2" fill="#f0c030" opacity=".65"/><polygon points="-8,2 -12,7 -5,5" fill="#c8340c" opacity=".55"/></g>
            <g transform="translate(26,58)"><circle cx="0" cy="0" r="5" fill="#1e6bb0" opacity=".8"/><circle cx="-8" cy="0" r="3" fill="#c84090" opacity=".65"/><circle cx="8" cy="0" r="3" fill="#c84090" opacity=".65"/><circle cx="0" cy="8" r="3" fill="#56b848" opacity=".65"/></g>
            <g transform="translate(26,80)"><ellipse cx="0" cy="0" rx="6" ry="4" fill="#56b848" opacity=".75"/><circle cx="7" cy="-2" r="2" fill="#c8920a" opacity=".65"/><polygon points="-8,2 -12,7 -5,5" fill="#2d8020" opacity=".55"/></g>
            <g transform="translate(26,102)"><circle cx="0" cy="0" r="4" fill="#c8920a" opacity=".65"/><circle cx="-6" cy="0" r="2" fill="#e8b050" opacity=".5"/><circle cx="6" cy="0" r="2" fill="#e8b050" opacity=".5"/></g>
          </svg>
        </div>
      </div>

      {/* ── 3-column links grid ───────────────────────────── */}
      <div className="ft-cols-grid" style={{
        width: '100%', boxSizing: 'border-box', padding: '32px 60px 28px',
        display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr', gap: '60px',
        background: '#0f2a14',
      }}>
        {/* Quick Selects */}
        <div>
          <div style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '2.5px', color: '#c8920a', textTransform: 'uppercase', marginBottom: '16px', paddingBottom: '8px', borderBottom: '1px solid rgba(200,146,10,.22)' }}>
            Quick Selects
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '11px' }}>
            {[
              ['🍯', 'Wild Honey',       '/products?category=wild-honey'],
              ['🧈', 'A2 Bilona Ghee',   '/products?category=ghee'],
              ['🌸', 'Kashmiri Saffron', '/products?category=saffron'],
              ['🪨', 'Ladakhi Shilajit', '/collections/shilajit'],
              ['🍃', 'Himalayan Teas',   '/collections/himalayan-teas'],
              ['🌾', 'Ancient Grains',   '/collections/heritage-rice'],
            ].map(([emoji, label, href]) => (
              <li key={label}>
                <Link href={href} style={{ fontSize: '14.5px', color: 'rgba(255,255,255,.55)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '7px', transition: 'all .2s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff'; (e.currentTarget as HTMLElement).style.paddingLeft = '5px' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,.55)'; (e.currentTarget as HTMLElement).style.paddingLeft = '0' }}
                >
                  {emoji} {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Company */}
        <div>
          <div style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '2.5px', color: '#c8920a', textTransform: 'uppercase', marginBottom: '16px', paddingBottom: '8px', borderBottom: '1px solid rgba(200,146,10,.22)' }}>
            Company
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '11px' }}>
            {[
              ['Our Story',          '/about'],
              ['By Region',          '/regions'],
              ['Returns & Refunds',  '/policies/returns'],
              ['Shipping Policy',    '/policies/shipping'],
              ['Privacy Policy',     '/policies/privacy'],
              ['Terms & Conditions', '/policies/terms'],
            ].map(([label, href]) => (
              <li key={label}>
                <Link href={href} style={{ fontSize: '14.5px', color: 'rgba(255,255,255,.55)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '7px', transition: 'all .2s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff'; (e.currentTarget as HTMLElement).style.paddingLeft = '5px' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,.55)'; (e.currentTarget as HTMLElement).style.paddingLeft = '0' }}
                >{label}</Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Connect With Us */}
        <div>
          <div style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '2.5px', color: '#c8920a', textTransform: 'uppercase', marginBottom: '16px', paddingBottom: '8px', borderBottom: '1px solid rgba(200,146,10,.22)' }}>
            Connect With Us
          </div>
          {[
            { icon: '🌐', text: 'pahadiroots.com', href: 'https://pahadiroots.com' },
            { icon: '📧', text: email2, href: `mailto:${email2}` },
            { icon: '📞', text: phone, href: `tel:${phone.replace(/\s/g,'')}` },
            { icon: '📍', text: address, href: undefined },
          ].map(item => (
            <div key={item.icon} style={{ display: 'flex', alignItems: 'flex-start', gap: '11px', marginBottom: '13px' }}>
              <span style={{ fontSize: '15px', flexShrink: 0, marginTop: '1px' }}>{item.icon}</span>
              <div style={{ fontSize: '14px', color: 'rgba(255,255,255,.5)', lineHeight: 1.7 }}>
                {item.href ? (
                  <a href={item.href} style={{ color: 'rgba(255,255,255,.5)', textDecoration: 'none' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,.5)' }}
                  >{item.text}</a>
                ) : item.text}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Social + FSSAI bar ────────────────────────────── */}
      <div className="ft-legal-row" style={{ width: '100%', boxSizing: 'border-box', padding: '24px 60px 28px', background: '#0f2a14' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', flexWrap: 'wrap', gap: '32px' }}>
          {/* Socials */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {/* Instagram */}
            <a href={instagramUrl} target="_blank" rel="noopener" title="Instagram" style={socStyle}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
            </a>
            {/* Facebook */}
            <a href={facebookUrl} target="_blank" rel="noopener" title="Facebook" style={socStyle}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            </a>
            {/* X/Twitter */}
            <a href={twitterUrl} target="_blank" rel="noopener" title="X" style={socStyle}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </a>
            {/* YouTube */}
            <a href={youtubeUrl} target="_blank" rel="noopener" title="YouTube" style={socStyle}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M23.495 6.205a3.007 3.007 0 0 0-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 0 0 .527 6.205a31.247 31.247 0 0 0-.522 5.805 31.247 31.247 0 0 0 .522 5.783 3.007 3.007 0 0 0 2.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 0 0 2.088-2.088 31.247 31.247 0 0 0 .5-5.783 31.247 31.247 0 0 0-.5-5.805zM9.609 15.601V8.408l6.264 3.602z"/></svg>
            </a>
            {/* Pinterest — BUG FIX: the admin panel already has a
                social_pinterest field (src/app/admin/settings/page.jsx),
                but this icon didn't exist anywhere on the live site at
                all, so there was nowhere for that setting to ever show
                up. No fallback URL — only renders once a real one is set. */}
            {pinterestUrl && (
              <a href={pinterestUrl} target="_blank" rel="noopener" title="Pinterest" style={socStyle}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.163-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.777 2.165 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146 1.124.347 2.317.535 3.554.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.367 18.592 0 11.985 0h.032z"/></svg>
              </a>
            )}
            {/* LinkedIn */}
            <a href={linkedinUrl} target="_blank" rel="noopener" title="LinkedIn" style={socStyle}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
            </a>
          </div>

          {/* FSSAI badge.
              BUG FIX (P1 — legal/compliance): this used to always render,
              with the license number hardcoded to the literal placeholder
              text "Lic. No. — update karein" — a real regulatory
              disclosure requirement for a food business in India, sitting
              in production as a note-to-self that was never filled in.
              Now: sourced from settings.fssai_license, and the whole
              badge (not just the number) is hidden until that's actually
              set — showing "Licensed" without a real number behind it
              would still be a false claim, just a differently-shaped one. */}
          {settings.fssai_license && (
            <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,.06)', borderRadius: '10px', padding: '8px 16px', display: 'inline-flex', alignItems: 'center', gap: '12px', boxShadow: '0 2px 10px rgba(0,0,0,.15)' }}>
              {/* Real FSSAI logo — the user provided the actual official
                  asset directly (public/fssai-logo.png), replacing the
                  earlier CSS-drawn approximation now that a real,
                  properly-licensed copy is available to use. */}
              <Image src="/fssai-logo.png" alt="FSSAI" width={56} height={43} style={{ objectFit: 'contain' }} />
              <div style={{ width: '1px', height: '26px', background: 'rgba(0,0,0,.1)' }} />
              <div>
                <div style={{ fontSize: '11px', color: '#1a3a1e', fontWeight: 800 }}>FSSAI Licensed</div>
                <div style={{ fontSize: '10.5px', color: '#5a6b5c', marginTop: '2px' }}>Lic. No. {settings.fssai_license}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Copyright bar + diamond vine ─────────────────── */}
      <div className="ft-bottom-row" style={{ maxWidth: '100%', padding: '14px 60px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', position: 'relative', zIndex: 2, background: '#0f2a14' }}>
        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,.28)', fontFamily: 'Lato,sans-serif' }}>
          © {new Date().getFullYear()} <strong style={{ color: 'rgba(255,255,255,.8)', fontWeight: 700 }}>HimVeda by Pahadi Roots</strong> · Himachal Pradesh, India
        </div>

        {/* Diamond vine divider */}
        <svg viewBox="0 0 1440 22" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', width: '100%', marginTop: '4px' }}>
          <line x1="0" y1="11" x2="1440" y2="11" stroke="#c8920a" strokeWidth=".5" opacity=".7"/>
          <g opacity=".9">
            {Array.from({ length: 38 }, (_, i) => 18 + i * 38).map(x => (
              <polygon key={x} points={`${x},11 ${x+6},5 ${x+12},11 ${x+6},17`} fill="none" stroke="#c8920a" strokeWidth=".8"/>
            ))}
          </g>
        </svg>
      </div>

      <style>{`
        /* BUG FIX (P1 — mobile layout): these selectors previously
           targeted inline styles directly, e.g.
           div[style*="padding: 36px 60px 28px"]. That can never match:
           React serializes inline styles with NO space after the
           property colon and kebab-case property names (so
           gridTemplateColumns: '1fr 1fr 1.4fr' in JS renders as
           "grid-template-columns:1fr 1fr 1.4fr" in the real DOM, not
           "grid-template-columns: 1fr 1fr 1.4fr" with a space) — every
           one of these rules was silently dead, and the footer's mobile
           breakpoint adjustments never applied. Fixed by giving each
           target div a real className above and selecting on that. */
        @media(max-width:960px) {
          footer .ft-cols-grid { grid-template-columns: 1fr 1fr !important; gap: 28px !important; padding: 28px 28px 20px !important; }
          footer .ft-brand-row { flex-wrap: wrap !important; gap: 16px !important; padding: 28px 28px 22px !important; }
          footer .ft-legal-row { padding: 20px 28px 24px !important; }
          footer .ft-bottom-row { padding: 12px 28px 18px !important; }
        }
        @media(max-width:640px) {
          footer .ft-cols-grid { grid-template-columns: 1fr !important; padding: 20px !important; }
          footer .ft-brand-row { padding: 20px !important; flex-direction: column !important; align-items: flex-start !important; }
          footer svg[width="52"] { display: none !important; }
          footer .ft-bottom-row { padding: 12px 20px !important; flex-direction: column !important; text-align: center !important; }
        }
      `}</style>
    </footer>
  )
}

const socStyle: React.CSSProperties = {
  width: '46px', height: '46px', borderRadius: '50%',
  background: 'rgba(255,255,255,.06)', border: '1px solid rgba(200,146,10,.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  transition: 'all .22s', color: 'rgba(255,255,255,.65)', textDecoration: 'none',
}
