'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { canAccessPage } from '@/lib/auth';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import LoginGate from '@/components/ui/LoginGate';
import { api, buildDateFilter } from '@/lib/api';

const PAGE_TITLES = {
  '/admin':                '📊 Dashboard',
  '/admin/analytics':      '📈 Analytics',
  '/admin/products':       '📦 Product Analytics',
  '/admin/customers':      '👥 Customer Insights',
  '/admin/profit':         '💰 Profit & Margins',
  '/admin/orders':         '🛒 Orders',
  '/admin/operations':     '⚙️ Operations',
  '/admin/coupons':        '🎁 Coupons',
  '/admin/marketing':      '📢 Marketing & Sales',
  '/admin/catalogue':      '📦 Catalogue',
  '/admin/vendors':        '🤝 Vendors',
  '/admin/vendor-portal':  '🏪 Vendor Portal',
  '/admin/logs/inventory': '📋 Inventory Logs',
  '/admin/logs/orders':    '🔄 Order Logs',
  '/admin/logs/admin':     '🔒 Admin Logs',
  '/admin/states':         '🗺️ States Management',
  '/admin/media':          '🖼️ Media & Homepage',
  '/admin/team':           '👥 Team',
  '/admin/settings':       '⚙️ Settings',
  '/admin/ai':              '🤖 AI Assistant',
};

// Separated into its own component so useSearchParams is inside Suspense
function AdminLayoutInner({ children }) {
  const { authed, role, loading, login, logout } = useAuth();
  const [pendingOrders, setPendingOrders] = useState(0);
  const [alerts, setAlerts] = useState([]);
  const pathname    = usePathname();
  const searchParams = useSearchParams();
  const router      = useRouter();

  const dateRange = parseInt(searchParams.get('days') || '7', 10);

  function handleDateChange(days) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('days', String(days));
    router.push(`${pathname}?${params.toString()}`);
  }

  useEffect(() => {
    if (!authed) return;
    api.get('orders', 'order_status=eq.pending&select=id')
      .then(d => setPendingOrders((d || []).length))
      .catch(() => {});
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    (async () => {
      try {
        const [prods, orders] = await Promise.all([
          api.get('products', 'select=name,available_stock&is_deleted=eq.false'),
          api.get('orders', `select=total_amount,created_at,order_status&created_at=gte.${buildDateFilter(7)}`),
        ]);
        const a = [];
        const low = (prods || []).filter(p => (p.available_stock || 0) <= 5);
        if (low.length) a.push({ type: 'red',    icon: '🚨', msg: `${low.length} products critically low` });
        const pend = (orders || []).filter(o => o.order_status === 'pending').length;
        if (pend > 5) a.push({ type: 'yellow', icon: '⏳', msg: `${pend} orders pending action` });
        const rev = (orders || []).filter(o => o.order_status !== 'cancelled').reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);
        if (rev > 1000) a.push({ type: 'green', icon: '📈', msg: `₹${Math.round(rev).toLocaleString('en-IN')} this week` });
        setAlerts(a);
      } catch (e) {}
    })();
  }, [authed]);

  if (loading) return <div className="fixed inset-0 flex items-center justify-center" style={{background:"var(--bg,#0d1117)",color:"var(--tx2,#6e7681)"}}>Loading…</div>;
  if (!authed) return <LoginGate onLogin={login} />;

  const title = PAGE_TITLES[pathname] || 'Admin';
  const pageName = pathname.replace('/admin/', '').replace('/admin', '') || 'dashboard';
  const currentRole = typeof window !== 'undefined' ? sessionStorage.getItem('pr_role') : null;

  if (pageName !== 'dashboard' && currentRole !== 'owner' && !canAccessPage(pageName)) {
    return (
      <div className="fixed inset-0 flex items-center justify-center" style={{background:"var(--bg,#0d1117)"}}>
        <div className="text-center">
          <div className="text-4xl mb-4">🔒</div>
          <div className="text-[var(--tx)] font-bold mb-2">Access Denied</div>
          <div className="text-sm" style={{color:"var(--tx2,#6e7681)"}}>Your role ({role}) cannot access this page.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-root fixed inset-0 flex" style={{background:"var(--bg,#0d1117)", fontFamily:"'Inter', sans-serif"}}>
      <Sidebar role={role} onLogout={logout} pendingOrders={pendingOrders} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar
          title={title}
          dateRange={dateRange}
          onDateChange={handleDateChange}
          onRefresh={() => window.location.reload()}
          alerts={alerts}
        />
        <main className="flex-1 overflow-y-auto p-6 text-[13.5px]" style={{color:"var(--tx,#e6edf3)"}}>
          {children}
        </main>
      </div>
    </div>
  );
}

// Outer layout wraps inner in Suspense — required by Next.js for useSearchParams
export default function AdminLayout({ children }) {
  return (
    <Suspense fallback={
      <div className="fixed inset-0 flex items-center justify-center" style={{background:"var(--bg,#0d1117)",color:"var(--tx2,#6e7681)"}}>
        Loading…
      </div>
    }>
      <AdminLayoutInner>{children}</AdminLayoutInner>
    </Suspense>
  );
}
