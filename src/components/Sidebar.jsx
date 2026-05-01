'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// ── Navigation structure
// type: 'link'  → plain nav item
// type: 'group' → collapsible section with children (Shopify-style)
const NAV = [
  { section: 'Overview' },
  { type: 'link', href: '/admin',            icon: '📊', label: 'Dashboard' },
  { type: 'link', href: '/admin/analytics',  icon: '📈', label: 'Analytics' },

  { section: 'Analytics' },
  { type: 'link', href: '/admin/customers',  icon: '👥', label: 'Customers' },
  { type: 'link', href: '/admin/profit',     icon: '💰', label: 'Profit'    },

  { section: 'Orders' },
  { type: 'link', href: '/admin/orders',     icon: '🛒', label: 'Orders',     badge: true },
  { type: 'link', href: '/admin/operations', icon: '⚙️',  label: 'Operations'             },
  { type: 'link', href: '/admin/returns',    icon: '↩️',  label: 'Returns'                },

  { section: 'Marketing' },
  { type: 'link', href: '/admin/coupons',    icon: '🎁', label: 'Coupons'   },
  { type: 'link', href: '/admin/marketing',  icon: '📢', label: 'Marketing' },

  { section: 'Catalogue' },
  {
    type: 'group', icon: '📦', label: 'Catalogue',
    matchPaths: ['/admin/catalogue'],
    children: [
      { href: '/admin/catalogue',                icon: '📦', label: 'Products'    },
      { href: '/admin/catalogue?tab=categories', icon: '🏷️',  label: 'Categories'  },
      { href: '/admin/catalogue?tab=gst',        icon: '📋', label: 'GST Manager' },
    ],
  },
  { type: 'link', href: '/admin/vendors', icon: '🤝', label: 'Vendors' },

  { section: 'Pricing' },
  {
    type: 'group', icon: '🧮', label: 'Pricing Engine',
    matchPaths: ['/admin/pricing'],
    children: [
      { href: '/admin/pricing',          icon: '🧮', label: 'Overview'          },
      { href: '/admin/pricing/new',      icon: '✨', label: 'New Product'       },
      { href: '/admin/pricing/existing', icon: '🔍', label: 'Existing Product'  },
      { href: '/admin/pricing/bulk',     icon: '📦', label: 'Bulk Calculator'   },
    ],
  },

  { section: 'Logs' },
  {
    type: 'group', icon: '📋', label: 'Logs',
    matchPaths: ['/admin/logs'],
    children: [
      { href: '/admin/logs/inventory', icon: '📦', label: 'Inventory Mgmt' },
      { href: '/admin/logs/orders',    icon: '🔄', label: 'Order Logs'     },
      { href: '/admin/logs/admin',     icon: '🔒', label: 'Admin Logs'     },
    ],
  },

  { section: 'Media' },
  { type: 'link', href: '/admin/states',            icon: '🗺️', label: 'States'           },
  { type: 'link', href: '/admin/team',              icon: '👥', label: 'Team'             },
  { type: 'link', href: '/admin/media/hero',        icon: '🎨', label: 'Hero Banners'     },
  { type: 'link', href: '/admin/media/collection',  icon: '🗂️', label: 'Collection Images'},

  { section: 'System' },
  { type: 'link', href: '/admin/settings', icon: '⚙️', label: 'Settings' },
  { type: 'link', href: '/admin/ai',       icon: '🤖', label: 'AI Assistant' },
];

const THEMES = [
  {
    label: '🌿 Forest Dark',
    accent: '#3fb950', bg: '#0d1117', bg2: '#161b22', bd: '#30363d',
    tx: '#e6edf3', tx2: '#8b949e', tx3: '#6e7681', inputBg: '#21262d', dark: true,
    blue: 'var(--blue)', blueBg: 'var(--blue-bg)', blueBd: 'var(--blue-bd)',
    purple: 'var(--purple)', purpleBg: 'var(--purple-bg)',
    yellow: '#d29922', yellowBg: 'var(--yellow-bg)',
    chartAxis: '#6e7681', chartGrid: 'rgba(255,255,255,0.06)',
    tooltipBg: '#161b22', tooltipBd: '#30363d',
  },
  {
    label: '🪵 Forest Cream',
    accent: '#2d6a1f', bg: '#f5f0e8', bg2: '#ede8d8', bd: '#c8b89a',
    tx: '#1a1a0f', tx2: '#4a4a3a', tx3: '#7a7a6a', inputBg: '#ddd8c8', dark: false,
    blue: '#1a5f9e', blueBg: 'rgba(26,95,158,0.12)', blueBd: 'rgba(26,95,158,0.3)',
    purple: '#6b3fa0', purpleBg: 'rgba(107,63,160,0.12)',
    yellow: '#8a5c00', yellowBg: 'rgba(138,92,0,0.12)',
    chartAxis: '#5a5a4a', chartGrid: 'rgba(0,0,0,0.08)',
    tooltipBg: '#ede8d8', tooltipBd: '#c8b89a',
  },
];

export default function Sidebar({ role, onLogout, pendingOrders = 0 }) {
  const pathname = usePathname();
  const [showThemes, setShowThemes] = useState(false);
  const [themeIdx, setThemeIdx]     = useState(0);
  const [openGroups, setOpenGroups] = useState({});

  // Auto-open group if a child is currently active
  useEffect(() => {
    const initial = {};
    NAV.forEach((item, i) => {
      if (item.type === 'group') {
        if (item.matchPaths?.some(p => pathname.startsWith(p))) initial[i] = true;
      }
    });
    setOpenGroups(initial);
  }, [pathname]);

  useEffect(() => {
    const saved = localStorage.getItem('pr_theme');
    if (saved) {
      try {
        const t = JSON.parse(saved);
        // v3.1 migration: reset old medium-green theme to dark-green
        if (t.accent === '#2d8a45') {
          localStorage.removeItem('pr_theme');
          localStorage.removeItem('pr_theme_idx');
          applyThemeCss(THEMES[0]);
          setThemeIdx(0);
        } else if (t.accent === '#1a5c2a' && !t.chartAxis) {
          // v3.2 migration: old theme missing chartAxis — reset to new defaults
          localStorage.removeItem('pr_theme');
          localStorage.removeItem('pr_theme_idx');
          applyThemeCss(THEMES[0]);
          setThemeIdx(0);
        } else {
          applyThemeCss(t);
          const idx = localStorage.getItem('pr_theme_idx');
          if (idx) setThemeIdx(parseInt(idx));
        }
      } catch(e) {}
    }
  }, []);

  function applyThemeCss(t) {
    const r = document.documentElement;
    r.style.setProperty('--accent',    t.accent);
    r.style.setProperty('--bg',        t.bg);
    r.style.setProperty('--bg2',       t.bg2);
    r.style.setProperty('--bd',        t.bd);
    r.style.setProperty('--tx',        t.tx);
    r.style.setProperty('--tx2',       t.tx2);
    r.style.setProperty('--tx3',       t.tx3      || (t.dark ? '#6e7681' : '#7a7a6a'));
    r.style.setProperty('--input-bg',  t.inputBg  || (t.dark ? '#21262d' : '#ddd8c8'));
    r.style.setProperty('--blue',       t.blue     || (t.dark ? 'var(--blue)' : '#1a5f9e'));
    r.style.setProperty('--blue-bg',    t.blueBg   || (t.dark ? 'var(--blue-bg)' : 'rgba(26,95,158,0.12)'));
    r.style.setProperty('--blue-bd',    t.blueBd   || (t.dark ? 'var(--blue-bd)'  : 'rgba(26,95,158,0.3)'));
    r.style.setProperty('--purple',     t.purple   || (t.dark ? 'var(--purple)' : '#6b3fa0'));
    r.style.setProperty('--purple-bg',  t.purpleBg || (t.dark ? 'var(--purple-bg)' : 'rgba(107,63,160,0.12)'));
    r.style.setProperty('--yellow',     t.yellow   || (t.dark ? '#d29922' : '#8a5c00'));
    r.style.setProperty('--yellow-bg',  t.yellowBg || (t.dark ? 'var(--yellow-bg)' : 'rgba(138,92,0,0.12)'));
    r.style.setProperty('--chart-axis',  t.chartAxis  || (t.dark ? '#6e7681' : '#5a5a4a'));
    r.style.setProperty('--chart-grid',  t.chartGrid  || (t.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'));
    r.style.setProperty('--tooltip-bg',  t.tooltipBg  || t.bg2);
    r.style.setProperty('--tooltip-bd',  t.tooltipBd  || t.bd);
    document.body.style.background = t.bg;
    document.body.style.color      = t.tx;
  }

  function applyTheme(t, idx) {
    applyThemeCss(t);
    setThemeIdx(idx);
    setShowThemes(false);
    localStorage.setItem('pr_theme', JSON.stringify(t));
    localStorage.setItem('pr_theme_idx', String(idx));
  }

  function toggleGroup(i) {
    setOpenGroups(s => ({ ...s, [i]: !s[i] }));
  }

  function isLinkActive(href) {
    if (!href) return false;
    // Exact match for index pages (no sub-paths)
    if (href === '/admin') return pathname === '/admin';
    if (href === '/admin/pricing') return pathname === '/admin/pricing';
    // For sub-pages, exact match
    return pathname === href;
  }

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col overflow-y-auto"
      style={{ background: 'var(--bg2,#161b22)', borderRight: '1px solid var(--bd,#1a5c2a)' }}>

      {/* Logo */}
      <div className="px-4 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--bd,#1a5c2a)' }}>
        <div className="text-[15px] font-bold" style={{ color: 'var(--tx,#ffffff)' }}>🌿 5 Pahadi Roots</div>
        <div className="text-[10px] mt-0.5" style={{ color: 'var(--tx2,#6e9a75)' }}>Admin Panel</div>
        <div className="text-[9px] font-bold mt-0.5" style={{ color: 'var(--accent,#1a5c2a)' }}>
          v3.0 · {role?.toUpperCase() || 'OWNER'}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2">
        {NAV.map((item, i) => {

          // Section header
          if (item.section) return (
            <div key={i} className="px-3.5 pt-3 pb-1 text-[9px] font-bold tracking-widest uppercase"
              style={{ color: 'var(--tx2,#6e9a75)' }}>
              {item.section}
            </div>
          );

          // Collapsible group
          if (item.type === 'group') {
            const groupActive = item.matchPaths?.some(p => pathname.startsWith(p));
            const isOpen      = !!openGroups[i];
            return (
              <div key={i}>
                <button onClick={() => toggleGroup(i)}
                  className="w-full flex items-center gap-2.5 px-5 py-1.5 text-[12px] font-medium transition-all"
                  style={groupActive
                    ? { color: 'var(--accent,#1a5c2a)', fontWeight: 600 }
                    : { color: 'var(--tx2,#6e9a75)' }}>
                  <span className="text-sm w-4 text-center flex-shrink-0">{item.icon}</span>
                  <span className="flex-1 text-left">{item.label}</span>
                  <span className="text-[11px] transition-all duration-200 mr-2"
                    style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block', opacity: 0.5 }}>
                    ›
                  </span>
                </button>

                {isOpen && (
                  <div className="ml-5 pl-2 mb-1"
                    style={{ borderLeft: '1px solid color-mix(in srgb, var(--accent,#1a5c2a) 35%, transparent)' }}>
                    {item.children.map((child, ci) => {
                      const active = isLinkActive(child.href);
                      return (
                        <Link key={ci} href={child.href}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] font-medium transition-all my-0.5"
                          style={active
                            ? { color: 'var(--accent,#1a5c2a)', background: 'color-mix(in srgb, var(--accent,#1a5c2a) 15%, transparent)', fontWeight: 700 }
                            : { color: 'var(--tx2,#6e9a75)' }}>
                          <span className="text-xs w-3.5 text-center flex-shrink-0">{child.icon}</span>
                          <span className="flex-1">{child.label}</span>
                          {active && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--accent,#1a5c2a)' }} />}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          // Plain link
          const active = isLinkActive(item.href);
          return (
            <Link key={i} href={item.href}
              className="flex items-center gap-2.5 mx-2 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all"
              style={active
                ? { color: 'var(--accent,#1a5c2a)', background: 'color-mix(in srgb, var(--accent,#1a5c2a) 15%, transparent)', fontWeight: 600 }
                : { color: 'var(--tx2,#6e9a75)' }}>
              <span className="text-sm w-4 text-center flex-shrink-0">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.badge && pendingOrders > 0 && (
                <span className="bg-[#f85149] text-[var(--tx)] text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                  {pendingOrders}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Theme Switcher */}
      <div className="px-2 pt-2" style={{ borderTop: '1px solid var(--bd,#1a5c2a)' }}>
        <button onClick={() => setShowThemes(!showThemes)}
          className="w-full text-left px-3 py-1.5 text-[11px] rounded-md transition flex items-center gap-2"
          style={{ color: 'var(--tx2,#6e9a75)' }}>
          🎨 <span>Theme</span>
          <span className="ml-auto text-[10px]">{showThemes ? '▲' : '▼'}</span>
        </button>
        {showThemes && (
          <div className="mt-1 space-y-0.5 pb-1">
            {THEMES.map((t, idx) => (
              <button key={idx} onClick={() => applyTheme(t, idx)}
                className="w-full text-left px-3 py-1 text-[11px] rounded-md transition flex items-center gap-2"
                style={themeIdx === idx
                  ? { background: 'color-mix(in srgb, var(--accent,#1a5c2a) 20%, transparent)', color: 'var(--tx,#ffffff)' }
                  : { color: 'var(--tx2,#6e9a75)' }}>
                <span className="w-2.5 h-2.5 rounded-full border border-[rgba(255,255,255,0.2)]"
                  style={{ background: t.accent }} />
                {t.label}
                {themeIdx === idx && <span className="ml-auto text-[10px]">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bottom */}
      <div className="p-2" style={{ borderTop: '1px solid var(--bd,#1a5c2a)' }}>
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold mb-1"
          style={{ color: 'var(--accent,#1a5c2a)', background: 'color-mix(in srgb, var(--accent,#1a5c2a) 12%, transparent)' }}>
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--accent,#1a5c2a)' }} />
          Live
        </div>
        <a href="https://pahadiroots.com" target="_blank" rel="noreferrer"
          className="flex items-center gap-2 w-full px-3 py-1 text-[11px] rounded-md transition mb-1"
          style={{ color: 'var(--tx2,#6e9a75)' }}>
          🌐 Live Site
        </a>
        <button onClick={onLogout}
          className="w-full text-left px-3 py-1 text-[11px] rounded-md transition"
          style={{ color: 'var(--tx2,#6e9a75)' }}>
          Sign Out
        </button>
      </div>
    </aside>
  );
}
