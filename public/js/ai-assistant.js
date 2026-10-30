/**
 * HimVeda by Pahadi Roots — AI Assistant v5.0
 * js/ai-assistant.js
 *
 * FIXES:
 *  1. Multilingual — AI auto-responds in selected language
 *  2. Real Gemini API called directly — no Edge Function needed
 *  3. Google Search grounding enabled — web search works
 *  4. getDemoReply() removed — real AI only
 *  5. Security restrictions in system prompt only — nothing else blocked
 *
 * USAGE in HTML:
 *   <script src="js/ai-assistant.js"
 *           data-whatsapp="919XXXXXXXXX">
 *   </script>
 */
(function () {
  'use strict';

  // No API key in frontend — key lives in Vercel environment variable only
  const script = document.currentScript
              || document.querySelector('script[data-whatsapp]');
  // BUG FIX (audit): the fallback used to be a placeholder number (919000000000), so a blank setting would have
  // sent customers to a stranger. With no number configured the WhatsApp button is simply not created.
  const WA_NUM = ((script && script.getAttribute('data-whatsapp')) || '').replace(/\D/g, '');

  /* ── API ENDPOINT — server proxy, key never exposed to browser ── */
  const API_URL = '/api/chat';

  /* ── THEME from site CSS vars ─────────────────────────── */
  const R = getComputedStyle(document.documentElement);
  const DARK_GREEN = (R.getPropertyValue('--g')   || '#1a3a1e').trim();
  const MID_GREEN  = (R.getPropertyValue('--g2')  || '#2d5233').trim();
  const GOLD       = (R.getPropertyValue('--gd')  || '#c8920a').trim();
  const GOLD2      = (R.getPropertyValue('--gd2') || '#e8b84b').trim();

  /* ── AI CONFIG ────────────────────────────────────────── */
  let AI_CFG = {
    name   : 'Pahadi_AI',
    tagline: 'Himalayan Shopping Guide · Online',
    avatar : 'data:image/webp;base64,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',
  };
  try {
    const s = JSON.parse(localStorage.getItem('pahadi_ai_config') || '{}');
    if (s.name)    AI_CFG.name    = s.name;
    if (s.tagline) AI_CFG.tagline = s.tagline;
  } catch(e) {}

  /* ── SYSTEM PROMPT ────────────────────────────────────── */
  // AUDIT S2-008: the system prompt now lives on the server (src/app/api/chat/systemPrompt.ts).
  // The browser only sends the chosen language code; it can no longer set instructions.

  /* ── STYLES ───────────────────────────────────────────── */
  const css = document.createElement('style');
  css.textContent = `
  /* WhatsApp button: shown only on desktop (min-width:901px). On mobile,
     pahadiroots-next's own bottom nav (MobileBottomNav.tsx) already has a
     "Chat" WhatsApp entry, so a second one here would duplicate it — but
     that bottom nav is mobile-only (display:none above 900px), so desktop
     had no WhatsApp entry point at all without this.
     Stacked 12px above the site's own scroll-to-top button (.stt-btn in
     globals.css: desktop bottom:24px, right:16px, 42px tall) instead of
     sharing its exact spot — round 3 put both at bottom:24/right:16, which
     overlapped them directly. */
  #pr-wa {
    display:none; position:fixed; right:16px; bottom:78px; /* 24 + 42 + 12 */
    width:52px; height:52px; border-radius:50%;
    background:#25D366; border:none; cursor:pointer;
    box-shadow:0 4px 16px rgba(37,211,102,.45);
    align-items:center; justify-content:center;
    transition:transform .2s cubic-bezier(.34,1.56,.64,1);
    z-index:2147483645;
  }
  @media(min-width:901px) { #pr-wa { display:flex } }
  #pr-wa:hover { transform:scale(1.1) }
  #pr-wa svg { width:27px; height:27px; fill:#fff }
  .pr-wa-tip {
    position:absolute; bottom:60px; left:50%; transform:translateX(-50%);
    background:rgba(0,0,0,.75); color:#fff; font-size:11px;
    padding:4px 10px; border-radius:7px; white-space:nowrap;
    opacity:0; pointer-events:none; transition:opacity .18s; font-family:inherit;
  }
  #pr-wa:hover .pr-wa-tip { opacity:1 }

  /* AI fab: stacked directly ABOVE the WhatsApp button, bottom right, so the
     three floating buttons read as one tidy column (AI, WhatsApp, scroll to
     top). Desktop: WhatsApp occupies bottom 78 to 130px, so the fab sits
     12px above it at 142px. Mobile (900px and below): WhatsApp is hidden
     (the bottom nav has its own Chat entry), so the fab sits 12px above the
     site's scroll to top button instead (16 + 56 nav + 42 button + 12 gap =
     126px, plus the iPhone safe area). The chat panel opens beside the fab
     and grows upward from the same baseline. */
  :root { --pr-fab-bottom: 142px; }
  @media(max-width:900px) { :root { --pr-fab-bottom: calc(126px + env(safe-area-inset-bottom,0px)); } }
  #pr-ai-fab {
    position:fixed; bottom:var(--pr-fab-bottom); right:16px;
    width:56px; height:56px; border-radius:50%;
    border:none; cursor:pointer; overflow:hidden;
    display:flex; align-items:center; justify-content:center;
    transition:transform .22s cubic-bezier(.34,1.56,.64,1);
    animation:pr-pulse 3s ease-out infinite;
    z-index:2147483645;
  }
  #pr-ai-fab:hover { transform:translateY(-6px) }
  #pr-ai-fab:active { transform:translateY(-2px) }
  #pr-ai-fab.open  { animation:none }
  #pr-ai-fab img.pr-fi { width:100%; height:100%; object-fit:cover; border-radius:50% }
  #pr-ai-fab .pr-fc { display:none; font-size:20px; color:#fff; font-family:inherit }
  #pr-ai-fab.open .pr-fi { display:none }
  #pr-ai-fab.open .pr-fc { display:block }
  .pr-badge {
    position:absolute; top:-2px; right:-2px;
    background:#ff5252; color:#fff; border-radius:50%;
    width:16px; height:16px; font-size:9px; font-weight:700;
    display:flex; align-items:center; justify-content:center; border:2px solid #fff;
  }
  @keyframes pr-pulse {
    0%   { box-shadow:0 0 0 0 rgba(26,58,30,.55), 0 6px 22px rgba(26,58,30,.5) }
    70%  { box-shadow:0 0 0 12px rgba(26,58,30,0), 0 6px 22px rgba(26,58,30,.5) }
    100% { box-shadow:0 0 0 0 rgba(26,58,30,0), 0 6px 22px rgba(26,58,30,.5) }
  }

  /* Opens beside the fab (86px = 16 right + 56 fab width + 14 gap),
     bottom-aligned to #pr-ai-fab and growing upward. */
  #pr-panel {
    position:fixed; bottom:var(--pr-fab-bottom); right:86px;
    width:380px; height:560px;
    min-width:280px; min-height:380px;
    max-width:min(700px,96vw); max-height:min(560px, calc(100vh - var(--pr-fab-bottom) - 16px));
    overflow:hidden; background:#ffffff; border-radius:18px;
    box-shadow:0 8px 40px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.06);
    display:flex; flex-direction:column;
    z-index:2147483644;
    transform:scale(.87) translateY(10px); opacity:0; pointer-events:none;
    visibility:hidden; /* BUG FIX (audit): opacity:0 alone left the closed panel's controls in the tab order */
    transition:transform .28s cubic-bezier(.34,1.2,.64,1), opacity .28s, visibility 0s linear .28s;
  }
  #pr-panel.open { transform:scale(1) translateY(0); opacity:1; pointer-events:all; visibility:visible; transition-delay:0s }
  /* Narrow phones: full width, sitting just above the fab (56px + 12px gap)
     so it never covers the fab or the send button. */
  @media(max-width:440px) { #pr-panel { width:calc(100vw - 16px) !important; right:8px; bottom:calc(var(--pr-fab-bottom) + 68px); min-height:280px; max-height:calc(100vh - var(--pr-fab-bottom) - 68px - 16px) } }

  #pr-drag {
    height:20px; border-radius:18px 18px 0 0;
    display:flex; align-items:center; justify-content:center;
    cursor:row-resize; flex-shrink:0; user-select:none;
  }
  #pr-drag::before { content:''; width:40px; height:3px; border-radius:3px; background:rgba(255,255,255,.22) }
  #pr-left-edge {
    position:absolute; left:0; top:20px; bottom:0; width:5px;
    cursor:ew-resize; z-index:10; border-radius:18px 0 0 18px;
  }
  #pr-left-edge:hover { background:rgba(200,146,10,.2) }
  #pr-bottom-edge {
    position:absolute; left:5px; right:0; bottom:0; height:5px;
    cursor:ns-resize; z-index:10;
  }
  #pr-bottom-edge:hover { background:rgba(200,146,10,.15) }
  /* Panel is now anchored at the bottom (fab baseline) and grows upward, so the
     bottom edge can no longer be dragged; the top handle and left edge resize it. */
  #pr-bottom-edge { display:none }

  .pr-hd {
    padding:11px 14px; display:flex; align-items:center; gap:10px; flex-shrink:0;
    border-bottom:1px solid rgba(200,146,10,.18);
  }
  .pr-hav { width:72px; height:72px; border-radius:50%; overflow:hidden; flex-shrink:0; border:2px solid rgba(200,146,10,.5); }
  .pr-hav img { width:100%; height:100%; object-fit:cover }
  .pr-hn { font-size:14px; font-weight:700; color:#f0ede0; line-height:1.2; font-family:inherit }
  .pr-hs { font-size:10px; font-family:inherit }
  .pr-dot { width:7px; height:7px; border-radius:50%; background:#4aad72; display:inline-block; margin-right:4px; animation:pr-blink 2s ease-in-out infinite }
  @keyframes pr-blink { 0%,100%{opacity:1} 50%{opacity:.3} }
  /* Custom Language Dropdown */
  .pr-lang-wrap {
    margin-left:auto; position:relative; flex-shrink:0;
  }
  .pr-lang-btn {
    display:flex; align-items:center; gap:5px;
    background:#ffffff; color:#1a3a1e;
    border:1.5px solid rgba(200,146,10,.8);
    border-radius:8px; padding:5px 10px;
    font-size:11.5px; font-weight:700; cursor:pointer;
    font-family:inherit; white-space:nowrap;
    min-width:80px; justify-content:space-between;
  }
  .pr-lang-btn:hover { background:#f0f7f1; }
  .pr-lang-arrow { font-size:9px; opacity:0.7; }
  .pr-lang-menu {
    display:none; position:absolute; right:0; top:calc(100% + 4px);
    background:#ffffff; border:1.5px solid #2d5233;
    border-radius:10px; overflow:hidden; z-index:99999;
    box-shadow:0 8px 24px rgba(0,0,0,.18);
    max-height:320px; min-width:190px;
    display:none; flex-direction:column;
  }
  .pr-lang-menu.open { display:flex; }
  .pr-lang-search-wrap {
    padding:8px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff;
  }
  .pr-lang-search {
    width:100%; box-sizing:border-box; padding:7px 10px;
    border:1.3px solid rgba(200,146,10,.5); border-radius:7px;
    font-size:12px; font-family:inherit; outline:none; color:#1a3a1e;
  }
  .pr-lang-search:focus { border-color:#2d5233; }
  .pr-lang-list {
    overflow-y:auto; flex:1;
    scrollbar-width:thin; scrollbar-color:#2d5233 #f0f7f1;
  }
  .pr-lang-group {
    padding:5px 10px 2px; font-size:9.5px; font-weight:800;
    color:#6b7280; text-transform:uppercase; letter-spacing:.5px;
    background:#f9fafb; border-bottom:1px solid #e5e7eb;
  }
  .pr-lang-opt {
    padding:8px 14px; font-size:12px; font-weight:600;
    color:#1a3a1e; cursor:pointer; transition:all .12s;
    font-family:inherit;
  }
  .pr-lang-opt:hover { background:#d4ecd9; color:#1a3a1e; }
  .pr-lang-opt.active { background:#2d5233; color:#ffffff; }
  .pr-lang-noresult {
    padding:14px; font-size:12px; color:#6b7280; text-align:center; font-family:inherit;
  }

  .pr-chips-toggle {
    padding:5px 12px; display:flex; align-items:center; gap:6px;
    background:#f0f7f1; border-bottom:1px solid #e5e7eb; flex-shrink:0;
    cursor:pointer; font-size:11px; font-weight:700; color:#1a3a1e;
    user-select:none;
  }
  .pr-chips-toggle:hover { background:#d4ecd9; }
  .pr-chips-arrow { font-size:9px; margin-left:auto; transition:transform .2s; }
  .pr-chips-arrow.open { transform:rotate(180deg); }
  .pr-chips { padding:7px 10px; flex-direction:row; flex-wrap:nowrap; gap:6px; overflow-x:auto; overflow-y:hidden; flex-shrink:0; scrollbar-width:none; border-bottom:1px solid #f3f4f6; background:#ffffff; display:none; }
  .pr-chips::-webkit-scrollbar { display:none }
  .pr-chips.open { display:flex !important; }
  .pr-chip { display:inline-flex; align-items:center; white-space:nowrap; border-radius:20px; padding:5px 12px; font-size:11px; cursor:pointer; transition:all .15s; flex-shrink:0; flex-grow:0; font-family:inherit; border:1.5px solid #2d5233; background:#f0f7f1; color:#1a3a1e; font-weight:600; }
  .pr-chip:hover { background:#d4ecd9; border-color:#1a3a1e; color:#1a3a1e; }

  .pr-msgs { flex:1; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:10px; background:#fafafa; scrollbar-width:thin; scrollbar-color:rgba(0,0,0,.1) transparent }
  .pr-msgs::-webkit-scrollbar { width:3px }
  .pr-msgs::-webkit-scrollbar-thumb { background:#d1d5db; border-radius:3px }
  .pr-m { display:flex; gap:7px; align-items:flex-end; animation:pr-in .25s ease-out }
  @keyframes pr-in { from{opacity:0;transform:translateY(7px)} to{opacity:1;transform:translateY(0)} }
  .pr-m.u { flex-direction:row-reverse }
  .pr-mav { width:28px; height:28px; border-radius:50%; flex-shrink:0; overflow:hidden; display:flex; align-items:center; justify-content:center }
  .pr-m.b .pr-mav img { width:100%; height:100%; object-fit:cover; border-radius:50% }
  .pr-m.u .pr-mav { background:rgba(255,255,255,.1); font-size:13px }
  .pr-mb { max-width:82%; padding:9px 13px; border-radius:15px; font-size:13px; line-height:1.55; font-family:inherit }
  .pr-m.b .pr-mb { background:#f3f4f6; color:#1a1a1a; border:1px solid rgba(0,0,0,.06); border-bottom-left-radius:4px }
  .pr-m.u .pr-mb { border-bottom-right-radius:4px; color:#fff }

  .pr-pcs { display:flex; flex-direction:column; gap:6px; margin-top:8px }
  .pr-pc { background:#f9fafb; border:1px solid #e5e7eb; border-radius:9px; padding:8px 10px; display:flex; align-items:center; gap:8px }
  .pr-pce { font-size:20px; flex-shrink:0 }
  .pr-pcn { font-size:12px; color:#111827; font-weight:600; line-height:1.3 }
  .pr-pcp { font-size:11px; margin-top:1px }
  .pr-pcb { margin-left:auto; border:none; border-radius:6px; padding:4px 9px; font-size:11px; cursor:pointer; font-weight:700; flex-shrink:0; transition:transform .15s; font-family:inherit }
  .pr-pcb:hover { transform:scale(1.05) }

  .pr-fb { display:flex; gap:4px; padding-left:35px; margin-top:2px }
  .pr-fb button { background:none; border:1px solid #e5e7eb; border-radius:5px; padding:2px 7px; font-size:11px; color:#6b7280; cursor:pointer; transition:all .15s; font-family:inherit }
  .pr-fb button.liked { border-color:#4aad72; color:#4aad72 }
  .pr-fb button.disliked { border-color:#ff5252; color:#ff5252 }

  .pr-dots { display:flex; gap:4px; padding:2px 0 }
  .pr-dots span { width:6px; height:6px; border-radius:50%; animation:pr-db .8s ease-in-out infinite }
  .pr-dots span:nth-child(2) { animation-delay:.15s }
  .pr-dots span:nth-child(3) { animation-delay:.3s }
  @keyframes pr-db { 0%,80%,100%{transform:scale(.6);opacity:.3} 40%{transform:scale(1);opacity:1} }

  .pr-ia { padding:10px 12px; border-top:1px solid rgba(0,0,0,.08); background:#ffffff; flex-shrink:0 }
  .pr-ir { display:flex; gap:7px; align-items:flex-end }
  #pr-ti { flex:1; background:#f3f4f6; border:1.5px solid #e5e7eb; border-radius:13px; padding:9px 12px; font-size:13px; color:#1a1a1a; resize:none; outline:none; font-family:inherit; max-height:100px; line-height:1.4; scrollbar-width:none; transition:border-color .2s }
  #pr-ti:focus { border-color:#2d5233; }
  #pr-ti::placeholder { color:#6b7280; }
  #pr-ti::-webkit-scrollbar { display:none }
  #pr-voice { background:none; border:1px solid #e5e7eb; border-radius:50%; width:35px; height:35px; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:all .2s }
  #pr-voice svg { width:15px; height:15px }
  #pr-voice.rec { border-color:#ff5252; animation:pr-rec .8s ease-in-out infinite }
  @keyframes pr-rec { 0%,100%{box-shadow:0 0 0 0 rgba(255,82,82,.4)} 50%{box-shadow:0 0 0 7px rgba(255,82,82,0)} }
  #pr-sb { width:35px; height:35px; flex-shrink:0; border-radius:50%; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:transform .15s }
  #pr-sb:hover:not(:disabled) { transform:scale(1.1) }
  #pr-sb:disabled { opacity:.35; cursor:not-allowed }
  #pr-sb svg { width:15px; height:15px }
  .pr-ft { text-align:center; font-size:9px; color:#6b7280; margin-top:6px; font-family:inherit }

  .pr-toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%) translateY(14px); border-radius:9px; padding:8px 18px; font-size:12px; font-weight:600; opacity:0; transition:all .28s; z-index:2147483647; pointer-events:none; font-family:inherit; white-space:nowrap }
  .pr-toast.show { opacity:1; transform:translateX(-50%) translateY(0) }
  /* Clear the mobile bottom nav (.mbn, 56px tall, MobileBottomNav.tsx). */
  @media(max-width:900px) { .pr-toast { bottom:calc(16px + 56px + env(safe-area-inset-bottom,0px)) } }
  .pr-src { font-size:10px; color:#6b7280; margin-top:4px; padding-left:35px; }
  .pr-src a { color:#2d5233; text-decoration:none }
  .pr-src a:hover { color:#1a3a1e; }
  `;
  document.head.appendChild(css);

  /* ── Apply theme colors ───────────────────────────────── */
  function applyTheme() {
    const fab2 = document.getElementById('pr-ai-fab');
    if(fab2){ fab2.style.background = DARK_GREEN; fab2.style.boxShadow = '0 6px 22px rgba(26,58,30,.5)'; }
    const hd = document.querySelector('.pr-hd');
    if(hd) hd.style.background = 'linear-gradient(135deg,' + DARK_GREEN + ',' + MID_GREEN + ')';
    const drag = document.getElementById('pr-drag');
    if(drag) drag.style.background = 'linear-gradient(135deg,' + DARK_GREEN + ',' + MID_GREEN + ')';
    // chip colors handled by CSS — no override needed
    // custom dropdown — no override needed
    const hs = document.querySelector('.pr-hs');
    if(hs) hs.style.color = GOLD2;
    const sb2 = document.getElementById('pr-sb');
    if(sb2){ sb2.style.background = GOLD; }
    const sbSvg = sb2 ? sb2.querySelector('svg') : null;
    if(sbSvg) sbSvg.style.fill = '#1a1a0a';
    const vSvg = document.querySelector('#pr-voice svg');
    if(vSvg) vSvg.style.fill = '#6b7280';
    document.querySelectorAll('.pr-dots span').forEach(s => s.style.background = GOLD);
    document.querySelectorAll('.pr-pcb').forEach(b => { b.style.background=GOLD; b.style.color='#1a1a0a'; });
  }

  /* ── WhatsApp button (desktop only — see #pr-wa CSS comment) ────── */
  const waBtn = document.createElement('button');
  waBtn.id = 'pr-wa';
  waBtn.setAttribute('aria-label', 'WhatsApp');
  waBtn.innerHTML = '<span class="pr-wa-tip">WhatsApp us</span><svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';
  waBtn.addEventListener('click', () => {
    window.open('https://wa.me/' + WA_NUM + '?text=' + encodeURIComponent('Namaste! I want to know more about your Himalayan products'), '_blank');
  });
  if (WA_NUM) document.body.appendChild(waBtn);

  /* ── AI FAB ───────────────────────────────────────────── */
  const fab = document.createElement('button');
  fab.id = 'pr-ai-fab';
  fab.setAttribute('aria-label', 'Chat with Pahadi_AI');
  fab.setAttribute('aria-expanded', 'false');
  fab.setAttribute('aria-controls', 'pr-panel');
  fab.innerHTML = '<img class="pr-fi" src="' + AI_CFG.avatar + '" alt=""><span class="pr-fc">✕</span><span class="pr-badge" id="pr-badge">1</span>';
  document.body.appendChild(fab);

  /* ── Panel ────────────────────────────────────────────── */
  const panel = document.createElement('div');
  panel.id = 'pr-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Chat with Pahadi_AI');
  panel.innerHTML = '<div id="pr-left-edge"></div><div id="pr-bottom-edge"></div><div id="pr-drag"></div>'
    + '<div class="pr-hd">'
    + '<div class="pr-hav"><img src="' + AI_CFG.avatar + '" alt=""></div>'
    + '<div><div class="pr-hn" id="pr-name">' + AI_CFG.name + '</div>'
    + '<div class="pr-hs"><span class="pr-dot"></span><span id="pr-tagline">' + AI_CFG.tagline + '</span></div></div>'
    + '<div class="pr-lang-wrap" id="pr-lang-wrap">'
    + '<button class="pr-lang-btn" id="pr-lang-btn" type="button" aria-haspopup="listbox" aria-label="Choose language"><span id="pr-lang-label">English</span><span class="pr-lang-arrow">▼</span></button>'
    + '<div class="pr-lang-menu" id="pr-lang-menu">'
    + '<div class="pr-lang-search-wrap"><input type="text" class="pr-lang-search" id="pr-lang-search" placeholder="Search language…" autocomplete="off"></div>'
    + '<div class="pr-lang-list" id="pr-lang-list">'
    + '<div class="pr-lang-group">⭐ Recommended</div>'
    + '<div class="pr-lang-opt" data-lang="kngr">कांगड़ी/हिमाचली — Kangri Pahari (HP)</div>'
    + '<div class="pr-lang-opt" data-lang="hi">हिंदी — Hindi</div>'
    + '<div class="pr-lang-opt active" data-lang="en">🇬🇧 English</div>'
    + '<div class="pr-lang-group">🇮🇳 More Indian Languages</div>'
    + '<div class="pr-lang-opt" data-lang="pa">ਪੰਜਾਬੀ — Punjabi</div>'
    + '<div class="pr-lang-opt" data-lang="bn">বাংলা — Bengali</div>'
    + '<div class="pr-lang-opt" data-lang="ta">தமிழ் — Tamil</div>'
    + '<div class="pr-lang-opt" data-lang="te">తెలుగు — Telugu</div>'
    + '<div class="pr-lang-opt" data-lang="mr">मराठी — Marathi</div>'
    + '<div class="pr-lang-opt" data-lang="gu">ગુજરાતી — Gujarati</div>'
    + '<div class="pr-lang-opt" data-lang="kn">ಕನ್ನಡ — Kannada</div>'
    + '<div class="pr-lang-opt" data-lang="ml">മലയാളം — Malayalam</div>'
    + '<div class="pr-lang-opt" data-lang="or">ଓଡ଼ିଆ — Odia</div>'
    + '<div class="pr-lang-opt" data-lang="ur">اردو — Urdu</div>'
    + '<div class="pr-lang-opt" data-lang="ne">नेपाली — Nepali</div>'
    + '<div class="pr-lang-opt" data-lang="mai">मैथिली — Maithili</div>'
    + '<div class="pr-lang-opt" data-lang="kok">कोंकणी — Konkani</div>'
    + '<div class="pr-lang-opt" data-lang="sa">संस्कृत — Sanskrit</div>'
    + '<div class="pr-lang-opt" data-lang="si">සිංහල — Sinhala</div>'
    + '<div class="pr-lang-group">🏔️ Other Pahadi Bolis</div>'
    + '<div class="pr-lang-opt" data-lang="garh">गढ़वाली — Garhwali (Uttarakhand)</div>'
    + '<div class="pr-lang-opt" data-lang="kum">कुमाऊँनी — Kumaoni (Uttarakhand)</div>'
    + '<div class="pr-lang-opt" data-lang="doi">डोगरी — Dogri (J&K)</div>'
    + '<div class="pr-lang-opt" data-lang="lad">Ladakhi — Ladakhi (Ladakh)</div>'
    + '<div class="pr-lang-group">🌿 Northeast India</div>'
    + '<div class="pr-lang-opt" data-lang="as">অসমীয়া — Assamese</div>'
    + '<div class="pr-lang-opt" data-lang="mni">মৈতৈ — Manipuri</div>'
    + '<div class="pr-lang-opt" data-lang="nag">Nagamese — Nagamese (Nagaland)</div>'
    + '<div class="pr-lang-opt" data-lang="bodo">बड़ो — Bodo (Assam)</div>'
    + '<div class="pr-lang-opt" data-lang="mizo">Mizo — Mizo (Mizoram)</div>'
    + '<div class="pr-lang-opt" data-lang="khasi">Khasi — Khasi (Meghalaya)</div>'
    + '<div class="pr-lang-opt" data-lang="sikkimese">Sikkimese — Sikkimese (Sikkim)</div>'
    + '<div class="pr-lang-group">🌍 Global Languages</div>'
    + '<div class="pr-lang-opt" data-lang="zh">中文 — Chinese</div>'
    + '<div class="pr-lang-opt" data-lang="ja">日本語 — Japanese</div>'
    + '<div class="pr-lang-opt" data-lang="ko">한국어 — Korean</div>'
    + '<div class="pr-lang-opt" data-lang="ar">العربية — Arabic</div>'
    + '<div class="pr-lang-opt" data-lang="fr">Français — French</div>'
    + '<div class="pr-lang-opt" data-lang="de">Deutsch — German</div>'
    + '<div class="pr-lang-opt" data-lang="es">Español — Spanish</div>'
    + '<div class="pr-lang-opt" data-lang="ru">Русский — Russian</div>'
    + '<div class="pr-lang-opt" data-lang="pt">Português — Portuguese</div>'
    + '<div class="pr-lang-noresult" id="pr-lang-noresult" style="display:none">No language found</div>'
    + '</div></div></div></div>'
    + '<div class="pr-chips-toggle" id="pr-chips-toggle"><span>💬 Quick Questions</span><span class="pr-chips-arrow" id="pr-chips-arrow">▼</span></div>'
    + '<div class="pr-chips" id="pr-chips">'
    + '<div class="pr-chip" data-q="Best honey recommendation?">🍯 Best honey</div>'
    + '<div class="pr-chip" data-q="Show products under 500 rupees">💰 Under ₹500</div>'
    + '<div class="pr-chip" data-q="Benefits of A2 Bilona Ghee?">🧈 Ghee benefits</div>'
    + '<div class="pr-chip" data-q="How to identify genuine Kashmiri saffron?">🌸 Real saffron?</div>'
    + '<div class="pr-chip" data-q="Delivery time and shipping details?">🚚 Delivery?</div>'
    + '<div class="pr-chip" data-q="What is the weather in Shimla today?">🌤️ Shimla weather</div>'
    + '<div class="pr-chip" data-q="Gift ideas from Himachal Pradesh?">🎁 Gift ideas</div>'
    + '<div class="pr-chip" data-q="What superfoods grow in the Himalayas?">🌿 Superfoods</div>'
    + '</div>'
    + '<div class="pr-msgs" id="pr-msgs" role="log" aria-live="polite" aria-label="Chat messages"></div>'
    + '<div class="pr-ia"><div class="pr-ir">'
    + '<button id="pr-voice" title="Voice input" aria-label="Voice input" type="button"><svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1 1.93c-3.94-.49-7-3.85-7-7.93H2c0 4.57 3.13 8.37 7.26 9.58V21h5.48v-3.42C18.87 16.37 22 12.57 22 8h-2c0 4.08-3.06 7.44-7 7.93V15.93z"/></svg></button>'
    + '<textarea id="pr-ti" rows="1" placeholder="Ask anything — products, weather, health…"></textarea>'
    + '<button id="pr-sb" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>'
    + '</div><div class="pr-ft">HimVeda by Pahadi Roots AI · Powered by Google Gemini</div></div>';
  document.body.appendChild(panel);

  const toast = document.createElement('div');
  toast.className = 'pr-toast';
  document.body.appendChild(toast);

  setTimeout(applyTheme, 50);

  /* ── RESIZE ───────────────────────────────────────────── */
  const dragBar    = document.getElementById('pr-drag');
  const leftEdge   = document.getElementById('pr-left-edge');
  const bottomEdge = document.getElementById('pr-bottom-edge');
  let resizing=false, resizeType='', rX0=0, rY0=0, rW0=0, rH0=0;

  function startResize(type, e) {
    resizing=true; resizeType=type;
    rX0=e.clientX; rY0=e.clientY;
    rW0=panel.offsetWidth; rH0=panel.offsetHeight;
    document.body.style.userSelect='none';
    document.body.style.cursor = type==='left' ? 'ew-resize' : 'ns-resize';
    e.preventDefault();
  }
  dragBar.addEventListener('mousedown',    function(e){ startResize('top',e); });
  leftEdge.addEventListener('mousedown',   function(e){ startResize('left',e); });
  bottomEdge.addEventListener('mousedown', function(e){ startResize('bottom',e); });
  document.addEventListener('mousemove', function(e) {
    if (!resizing) return;
    var maxW=Math.min(700,window.innerWidth*.96), maxH=window.innerHeight*.92;
    if (resizeType==='top')    panel.style.height=Math.min(Math.max(rH0+(rY0-e.clientY),380),maxH)+'px';
    if (resizeType==='left')   panel.style.width =Math.min(Math.max(rW0+(rX0-e.clientX),280),maxW)+'px';
    if (resizeType==='bottom') panel.style.height=Math.min(Math.max(rH0-(rY0-e.clientY),380),maxH)+'px';
  });
  document.addEventListener('mouseup', function() {
    if(resizing){ resizing=false; document.body.style.userSelect=''; document.body.style.cursor=''; }
  });
  dragBar.addEventListener('touchstart', function(e){ var t=e.touches[0]; resizing=true; resizeType='top'; rY0=t.clientY; rH0=panel.offsetHeight; },{passive:true});
  leftEdge.addEventListener('touchstart', function(e){ var t=e.touches[0]; resizing=true; resizeType='left'; rX0=t.clientX; rW0=panel.offsetWidth; },{passive:true});
  document.addEventListener('touchmove', function(e){
    if(!resizing) return; var t=e.touches[0];
    if(resizeType==='top')  panel.style.height=Math.min(Math.max(rH0+(rY0-t.clientY),380),window.innerHeight*.9)+'px';
    if(resizeType==='left') panel.style.width =Math.min(Math.max(rW0+(rX0-t.clientX),280),700)+'px';
  },{passive:true});
  document.addEventListener('touchend', function(){ resizing=false; });

  /* ── STATE ────────────────────────────────────────────── */
  var isOpen=false, isThinking=false, history=[], lang='en', isRec=false, rec=null;
  var msgs    = document.getElementById('pr-msgs');
  var input   = document.getElementById('pr-ti');
  var sb      = document.getElementById('pr-sb');
  var voice   = document.getElementById('pr-voice');
  // langSel removed — using custom dropdown now

  var LANG_NAMES = {
    en:'English', hi:'Hindi', pa:'Punjabi', bn:'Bengali', ta:'Tamil', te:'Telugu',
    mr:'Marathi', gu:'Gujarati', kn:'Kannada', ml:'Malayalam', or:'Odia', as:'Assamese',
    ne:'Nepali', doi:'Dogri', kngr:'Kangri Pahari (Himachali)', garh:'Garhwali',
    kum:'Kumaoni', lad:'Ladakhi',
    ur:'Urdu', sa:'Sanskrit', mai:'Maithili', kok:'Konkani', mni:'Manipuri', si:'Sinhala',
    nag:'Nagamese', bodo:'Bodo', mizo:'Mizo', khasi:'Khasi', sikkimese:'Sikkimese',
    zh:'Chinese', ja:'Japanese', ko:'Korean', ar:'Arabic',
    fr:'French', de:'German', es:'Spanish', ru:'Russian', pt:'Portuguese',
  };

  var VOICE_MAP = {
    en:'en-IN', hi:'hi-IN', pa:'pa-IN', bn:'bn-IN', ta:'ta-IN', te:'te-IN',
    mr:'mr-IN', gu:'gu-IN', kn:'kn-IN', ml:'ml-IN', or:'or-IN', as:'as-IN',
    ne:'ne-NP', kngr:'hi-IN', garh:'hi-IN', doi:'hi-IN', kum:'hi-IN', lad:'hi-IN',
    nag:'en-IN', bodo:'hi-IN', mizo:'en-IN', khasi:'en-IN', sikkimese:'ne-NP',
    ur:'ur-PK', si:'si-LK', zh:'zh-CN', ru:'ru-RU', pt:'pt-BR', ja:'ja-JP', ko:'ko-KR', ar:'ar-SA', fr:'fr-FR',
    de:'de-DE', es:'es-ES',
  };

  var PLACEHOLDERS = {
    hi:'कुछ भी पूछें — उत्पाद, मौसम, स्वास्थ्य…',
    pa:'ਕੁਝ ਵੀ ਪੁੱਛੋ — ਉਤਪਾਦ, ਮੌਸਮ…',
    bn:'যেকোনো কিছু জিজ্ঞেস করুন…',
    ta:'எதையும் கேளுங்கள்…',
    te:'ఏమైనా అడగండి…',
    mr:'काहीही विचारा…',
    gu:'કંઈ પણ પૂછો…',
    kn:'ಏನಾದರೂ ಕೇಳಿ…',
    ml:'എന്തും ചോദിക്കൂ…',
    ar:'اسأل أي شيء…',
    zh:'请随便问…',
    ja:'何でも聞いてください…',
  };

  /* ── CUSTOM LANGUAGE DROPDOWN ─────────────────────────── */
  var langBtn  = document.getElementById('pr-lang-btn');
  var langMenu = document.getElementById('pr-lang-menu');
  var langLabel = document.getElementById('pr-lang-label');

  langBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    langMenu.classList.toggle('open');
  });

  document.addEventListener('click', function() {
    langMenu.classList.remove('open');
  });

  langMenu.addEventListener('click', function(e) {
    var opt = e.target.closest('.pr-lang-opt');
    if (!opt) return;
    var newLang = opt.getAttribute('data-lang');
    // Update active state
    langMenu.querySelectorAll('.pr-lang-opt').forEach(function(o) { o.classList.remove('active'); });
    opt.classList.add('active');
    // Update button label
    langLabel.textContent = opt.textContent;
    langMenu.classList.remove('open');
    // Apply language
    lang = newLang;
    input.placeholder = PLACEHOLDERS[lang] || 'Ask anything — products, weather, health…';
    history = [];
    msgs.innerHTML = '';
    welcome();
  });

  /* ── LANGUAGE SEARCH ──────────────────────────────────── */
  // Filters the long language list live as the user types (matches native
  // script or English name, e.g. "kangri", "pun", "हिंदी"). Group headers
  // hide themselves when every option under them is filtered out, and a
  // "No language found" row appears if the query matches nothing.
  var langSearch  = document.getElementById('pr-lang-search');
  var langNoRes   = document.getElementById('pr-lang-noresult');
  if (langSearch) {
    langSearch.addEventListener('click', function(e) { e.stopPropagation(); });
    langSearch.addEventListener('input', function() {
      var q = langSearch.value.trim().toLowerCase();
      var anyVisible = false;
      var rows = langMenu.querySelectorAll('#pr-lang-list > div');
      var pendingGroup = null;
      var groupHasVisibleOpt = false;
      rows.forEach(function(row) {
        if (row.classList.contains('pr-lang-group')) {
          if (pendingGroup) pendingGroup.style.display = groupHasVisibleOpt ? '' : 'none';
          pendingGroup = row;
          groupHasVisibleOpt = false;
          return;
        }
        if (row.id === 'pr-lang-noresult') return;
        var match = !q || row.textContent.toLowerCase().indexOf(q) !== -1;
        row.style.display = match ? '' : 'none';
        if (match) { anyVisible = true; groupHasVisibleOpt = true; }
      });
      if (pendingGroup) pendingGroup.style.display = groupHasVisibleOpt ? '' : 'none';
      if (langNoRes) langNoRes.style.display = anyVisible ? 'none' : 'block';
    });
  }
  // Reset the search box on every toggle so old filter text doesn't hide
  // options next time the dropdown opens; focus it once open.
  langBtn.addEventListener('click', function() {
    if (!langSearch) return;
    langSearch.value = '';
    langSearch.dispatchEvent(new Event('input'));
    setTimeout(function() {
      if (langMenu.classList.contains('open')) langSearch.focus();
    }, 60);
  });

  /* ── TOGGLE ───────────────────────────────────────────── */
  function syncFabA11y() {
    fab.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    fab.setAttribute('aria-label', isOpen ? 'Close chat' : 'Chat with Pahadi_AI');
  }
  fab.addEventListener('click', function() {
    isOpen = !isOpen;
    fab.classList.toggle('open', isOpen);
    panel.classList.toggle('open', isOpen);
    syncFabA11y();
    var b = document.getElementById('pr-badge');
    if(b) b.remove();
    if(isOpen && !msgs.children.length) welcome();
    if(isOpen) setTimeout(function(){ input.focus(); }, 300);
    if(isOpen) setTimeout(applyTheme, 60);
  });
  document.addEventListener('click', function(e) {
    if(isOpen && !panel.contains(e.target) && !fab.contains(e.target)) {
      isOpen=false; fab.classList.remove('open'); panel.classList.remove('open'); syncFabA11y();
    }
  });
  // Escape closes the chat and hands focus back to the button that opened it (WCAG 2.1.2 / 2.4.3).
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && isOpen) {
      isOpen = false; fab.classList.remove('open'); panel.classList.remove('open'); syncFabA11y(); fab.focus();
    }
  });
  // Toggle chips
  var chipsToggle = document.getElementById('pr-chips-toggle');
  var chipsDiv    = document.getElementById('pr-chips');
  var chipsArrow  = document.getElementById('pr-chips-arrow');

  // Null-safe — hide chips on load
  if (chipsDiv) chipsDiv.style.display = 'none';

  if (chipsToggle) {
    chipsToggle.addEventListener('click', function() {
      if (!chipsDiv) return;
      var isOpen = chipsDiv.style.display === 'flex';
      chipsDiv.style.display = isOpen ? 'none' : 'flex';
      if (chipsArrow) chipsArrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
    });
  }

  panel.querySelectorAll('.pr-chip').forEach(function(c) {
    c.addEventListener('click', function() {
      send(c.getAttribute('data-q'));
      if (chipsDiv) chipsDiv.style.display = 'none';
      if (chipsArrow) chipsArrow.style.transform = 'rotate(0deg)';
    });
  });

  /* ── WELCOME MESSAGE ──────────────────────────────────── */
  function welcome() {
    var w = {
      en: '🙏 Namaste! I am **' + AI_CFG.name + '** — your Himalayan guide!\n\nI can help with:\n• Our Himalayan products — benefits, how to use, authenticity\n• Delivery, returns, any questions\n\nWhat would you like to know?',
      hi: '🙏 नमस्ते! मैं **' + AI_CFG.name + '** हूँ — आपका Himalayan guide!\n\nमैं इनमें मदद कर सकता हूँ:\n• हमारे शुद्ध Himalayan उत्पाद\n• Delivery और returns\n\nआज क्या जानना है?',
      pa: '🙏 ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ! ਮੈਂ **' + AI_CFG.name + '** ਹਾਂ!\n\nਮੈਂ ਮਦਦ ਕਰ ਸਕਦਾ ਹਾਂ:\n• ਸਾਡੇ Himalayan ਉਤਪਾਦ\n• Delivery ਅਤੇ returns\n\nਦੱਸੋ ਕੀ ਚਾਹੀਦਾ ਹੈ?',
      bn: '🙏 নমস্কার! আমি **' + AI_CFG.name + '** — আপনার Himalayan গাইড!\n\nআমি সাহায্য করতে পারি:\n• Himalayan পণ্য ও উপকারিতা\n• Delivery ও returns\n\nকী জানতে চান?',
      ta: '🙏 வணக்கம்! நான் **' + AI_CFG.name + '** — உங்கள் Himalayan வழிகாட்டி!\n\nநான் உதவலாம்:\n• Himalayan தயாரிப்புகள்\n• Delivery, returns\n\nஎன்ன தெரிந்துகொள்ள விரும்புகிறீர்கள்?',
      te: '🙏 నమస్కారం! నేను **' + AI_CFG.name + '** — మీ Himalayan గైడ్!\n\nనేను సహాయపడగలను:\n• Himalayan ఉత్పత్తులు\n• Delivery, returns\n\nమీకు ఏమి తెలుసుకోవాలి?',
      mr: '🙏 नमस्कार! मी **' + AI_CFG.name + '** — तुमचा Himalayan मार्गदर्शक!\n\nमी मदत करू शकतो:\n• Himalayan उत्पादने\n• Delivery, returns\n\nकाय जाणून घ्यायचे आहे?',
      gu: '🙏 નમસ્તે! હું **' + AI_CFG.name + '** — તમારો Himalayan ગાઇડ!\n\nહું મદદ કરી શકું:\n• Himalayan ઉત્પાદનો\n• Delivery, returns\n\nશું જાણવું છે?',
      kngr: '🙏 राम राम जी! मई **' + AI_CFG.name + '** हां — थुआड़ा Himachali गाइड!\n\nमई इत मदद करी सकदा हां:\n• साड़े असल पहाड़ी माल — मखीर (शहद), घियो (घी), केसर\n• Delivery ते returns\n\nदस्सो, किसी चीज़ दी लोड़ हाई?',
      garh: '🙏 नमस्कार! मी **' + AI_CFG.name + '** छूं — तुमारो Himalayan गाइड!\n\nमी यूँ मदद करी सकदूं:\n• हमारा Himalayan उत्पाद\n• Delivery अर returns\n\nबताओ, क्या जाणनो छ?',
      doi: '🙏 राम राम! मैं **' + AI_CFG.name + '** आं — तुंदा Himalayan guide!\n\nमैं इत्थें मदद करी सकदा आं:\n• साडे Himalayan उत्पाद\n• Delivery ते returns\n\nदस्सो की जानना ऐ?',
      kum: '🙏 नमस्कार! मैं **' + AI_CFG.name + '** छु — तुमर Himalayan गाइड!\n\nमैं यूँ मदद करि सकूँ:\n• हमर असली पहाड़ी उत्पाद\n• Delivery, returns\n\nबताओ क्या चनो?',
      lad: '🙏 Juley! I am **' + AI_CFG.name + '** — your Himalayan guide!\n\nI can help with:\n• Our pure Ladakhi & Himalayan products\n• Delivery, returns\n\nYang cho dukpo? (What do you need?)',
      or: '🙏 ନମସ୍କାର! ମୁଁ **' + AI_CFG.name + '** — ଆପଣଙ୍କର Himalayan ଗାଇଡ଼!\n\nମୁଁ ସାହାଯ୍ୟ କରିପାରିବି:\n• Himalayan ଉତ୍ପାଦ\n• Delivery, returns\n\nଆପଣ କଣ ଜାଣିବାକୁ ଚାହୁଁଛନ୍ତି?',
      as: '🙏 নমস্কাৰ! মই **' + AI_CFG.name + '** — আপোনাৰ Himalayan গাইড!\n\nমই উপকাৰ কৰিব পাৰোঁ:\n• আমাৰ বিশুদ্ধ Himalayan সামগ্ৰী — মৌ (শহদ), ঘিউ, কেচৰ\n• Delivery আৰু returns\n\nআপুনি কি বিচাৰে? কওক!\n(আপোনাৰ = Your, মোৰ = My, বাৰু = Good, দুখ = Sad, উপকাৰ = Help)',
      ne: '🙏 नमस्ते! म **' + AI_CFG.name + '** हुँ — तपाईंको Himalayan गाइड!\n\nमैले मद्दत गर्न सक्छु:\n• हाम्रा Himalayan उत्पादनहरू\n• Delivery, returns\n\nके जान्न चाहनुहुन्छ?',
      ur: '🙏 آداب! میں **' + AI_CFG.name + '** ہوں — آپ کا Himalayan گائیڈ!\n\nمیں مدد کر سکتا ہوں:\n• ہمارے خالص Himalayan مصنوعات\n• Delivery, returns\n\nبتائیں، کیا جاننا ہے?',
      nag: '🙏 Namaste! Me **' + AI_CFG.name + '** — tumhara Himalayan guide!\n\nMe help dibo pari:\n• Hamara pure Himalayan product — shahad, ghee, kesar\n• Delivery, returns\n\nBolo, ki chahiye?',
      bodo: '🙏 Namaskar! Mwi **' + AI_CFG.name + '** — nwngni Himalayan guide!\n\nMwi help dibo:\n• Himalayan products — shahad, ghee, kesar\n• Delivery, returns\n\nBolo ki chahiye?',
      mizo: '🙏 Chibai! Ka hming chu **' + AI_CFG.name + '** — i Himalayan guide!\n\nKa tanpui theih:\n• Himalayan products — shahad, ghee, kesar\n• Delivery, returns\n\nHe la, i duh engzat nge?',
      khasi: '🙏 Khublei! Nga **' + AI_CFG.name + '** — ngi Himalayan guide!\n\nNga sngewbha:\n• Himalayan products — shahad, ghee, kesar\n• Delivery, returns\n\nLa hap, ia la leh?',
    };
    addMsg('bot', w[lang] || w.en, [], true);
  }

  /* ── SAFE RENDER HELPERS (AUDIT S2-007) ───────────────── */
  // Appends `text` to `el` using only text nodes, <strong> and <br> — never innerHTML.
  function renderRichText(el, text) {
    var str = String(text == null ? '' : text);
    var lines = str.split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (i > 0) el.appendChild(document.createElement('br'));
      var parts = lines[i].split(/\*\*(.*?)\*\*/g);
      for (var j = 0; j < parts.length; j++) {
        if (!parts[j]) continue;
        if (j % 2 === 1) {
          var strong = document.createElement('strong');
          strong.textContent = parts[j];
          el.appendChild(strong);
        } else {
          el.appendChild(document.createTextNode(parts[j]));
        }
      }
    }
  }
  // Returns the URL string only when it is an absolute http(s) URL, else null.
  function safeHttpUrl(raw) {
    try {
      var u = new URL(String(raw));
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
    } catch (e) { return null; }
  }
  if (typeof window !== 'undefined') {
    window.__pahadiAiSafeRender = { renderRichText: renderRichText, safeHttpUrl: safeHttpUrl };
  }

  /* ── ADD MESSAGE ──────────────────────────────────────── */
  function addMsg(role, text, sources, skipHistory) {
    sources = sources || [];
    skipHistory = skipHistory || false;
    var wrap = document.createElement('div');
    wrap.className = 'pr-m ' + (role==='user' ? 'u' : 'b');
    var av = document.createElement('div'); av.className='pr-mav';
    if(role==='user') { av.textContent='👤'; }
    else { av.innerHTML='<img src="' + AI_CFG.avatar + '" alt="">'; }
    var bbl = document.createElement('div'); bbl.className='pr-mb';
    if(role==='user') { bbl.style.background='linear-gradient(135deg,'+MID_GREEN+',#3d6b42)'; }
    // AUDIT S2-007: model output is NEVER assigned via innerHTML. Text is split into
    // lines and **bold** runs and appended as text nodes / <strong>/<br> elements only.
    renderRichText(bbl, text);
    wrap.appendChild(av); wrap.appendChild(bbl);
    msgs.appendChild(wrap);

    // Show search sources if any
    if(sources && sources.length) {
      var srcDiv = document.createElement('div');
      srcDiv.className = 'pr-src';
      srcDiv.appendChild(document.createTextNode('🔍 '));
      // AUDIT S2-007: source titles/URLs come from search grounding (third-party content) —
      // built with createElement/textContent, href only when it parses as http(s).
      var shown = 0;
      sources.slice(0,2).forEach(function(s){
        var href = safeHttpUrl(s.uri);
        if(!href) return;
        if(shown++) srcDiv.appendChild(document.createTextNode(' · '));
        var a = document.createElement('a');
        a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.textContent = String(s.title || href).substring(0,40) + '…';
        srcDiv.appendChild(a);
      });
      msgs.appendChild(srcDiv);
    }

    if(role==='bot' && !skipHistory) {
      var fb = document.createElement('div'); fb.className='pr-fb';
      fb.innerHTML='<button type="button" aria-label="Helpful">👍</button><button type="button" aria-label="Not helpful">👎</button>';
      fb.querySelectorAll('button').forEach(function(btn,i){
        btn.addEventListener('click', function(){
          fb.querySelectorAll('button').forEach(function(b){ b.classList.remove('liked','disliked'); });
          btn.classList.add(i===0?'liked':'disliked');
        });
      });
      msgs.appendChild(fb);
    }
    msgs.scrollTop = msgs.scrollHeight;
    if(!skipHistory) history.push({role:'user'===role?'user':'model', parts:[{text:text}]});
  }

  function showTyping(){
    var el=document.createElement('div'); el.id='pr-typ'; el.className='pr-m b';
    el.innerHTML='<div class="pr-mav"><img src="'+AI_CFG.avatar+'" alt=""></div>'
      +'<div class="pr-mb" style="background:#152018"><div class="pr-dots">'
      +'<span style="background:'+GOLD+'"></span><span style="background:'+GOLD+'"></span><span style="background:'+GOLD+'"></span>'
      +'</div></div>';
    msgs.appendChild(el); msgs.scrollTop=msgs.scrollHeight;
  }
  function hideTyping(){ var e=document.getElementById('pr-typ'); if(e) e.remove(); }

  /* ── SEND ─────────────────────────────────────────────── */
  function send(txt) {
    var t = (txt || input.value).trim();
    if(!t || isThinking) return;
    input.value=''; input.style.height='auto';
    addMsg('user', t);
    isThinking=true; sb.disabled=true; showTyping();
    callGemini(t).then(function(r){
      hideTyping();
      addMsg('bot', r.text, r.sources||[]);
      isThinking=false; sb.disabled=false; input.focus();
    }).catch(function(err){
      hideTyping();
      console.error('[Pahadi_AI]', err);
      var errMsg = {
        en: '🙏 Sorry, I had trouble connecting. Please try again in a moment.',
        hi: '🙏 माफ़ करें, connection में कुछ दिक्कत आई। दोबारा try करें।',
        pa: '🙏 ਮਾਫ਼ ਕਰੋ, connection ਵਿੱਚ ਸਮੱਸਿਆ ਆਈ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
      };
      addMsg('bot', errMsg[lang] || errMsg.en);
      isThinking=false; sb.disabled=false;
    });
  }

  /* ── GEMINI API CALL ──────────────────────────────────── */
  function callGemini(userMsg) {
    // AUDIT S2-008: no instructions, tools or generation settings are sent from the browser —
    // the server owns all of them. Only the language code and the conversation go up.
    // Build conversation — last 10 turns for context
    var contents = history.slice(-10).concat([
      { role:'user', parts:[{ text: userMsg }] }
    ]);

    var body = {
      lang: lang,
      contents: contents
    };

    // Call our secure server proxy — key never in browser
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    .then(function(res){
      if(!res.ok) return res.json().then(function(e){ throw new Error(e.error?.message || 'HTTP '+res.status); });
      return res.json();
    })
    .then(function(data){
      var candidate = data.candidates && data.candidates[0];
      if(!candidate) throw new Error('No candidates in response');

      // Extract text from parts
      var text = '';
      if(candidate.content && candidate.content.parts) {
        candidate.content.parts.forEach(function(p){
          if(p.text) text += p.text;
        });
      }
      if(!text) throw new Error('Empty text response');

      // Extract search sources if Gemini used web search
      var sources = [];
      if(candidate.groundingMetadata && candidate.groundingMetadata.groundingChunks) {
        candidate.groundingMetadata.groundingChunks.forEach(function(chunk){
          if(chunk.web && chunk.web.uri) {
            sources.push({ uri: chunk.web.uri, title: chunk.web.title || '' });
          }
        });
      }

      // Add to conversation history
      history.push({ role:'model', parts:[{ text: text }] });

      return { text: text, sources: sources };
    });
  }

  /* ── VOICE ────────────────────────────────────────────── */
  voice.addEventListener('click', function(){
    if(!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)){
      addMsg('bot','🎤 Voice works in Chrome. Please type your question!'); return;
    }
    if(isRec){ if(rec) rec.stop(); voice.classList.remove('rec'); isRec=false; return; }
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    rec=new SR(); rec.lang=VOICE_MAP[lang]||'en-IN'; rec.interimResults=false;
    rec.onresult=function(e){ input.value=e.results[0][0].transcript; autoR(input); voice.classList.remove('rec'); isRec=false; };
    rec.onerror=function(){ voice.classList.remove('rec'); isRec=false; };
    rec.start(); voice.classList.add('rec'); isRec=true;
  });

  input.addEventListener('keydown', function(e){ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();} });
  input.addEventListener('input', function(){ autoR(input); });
  sb.addEventListener('click', function(){ send(); });
  function autoR(el){ el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,100)+'px'; }

})();
