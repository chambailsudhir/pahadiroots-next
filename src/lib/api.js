const ADMIN_API = '/api/admin';

async function request(method, table, query = '', body = null) {
  const pw = typeof window !== 'undefined' ? sessionStorage.getItem('pr_pw') : null;
  if (!pw) throw new Error('NOT_AUTHENTICATED');
  const res = await fetch(ADMIN_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': pw,
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({ method, table, query, body, _ts: Date.now() }),
  });
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (res.status === 429) throw new Error('RATE_LIMITED');
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || `HTTP ${res.status}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const api = {
  get:    (table, query)       => request('GET',    table, query),
  post:   (table, body)        => request('POST',   table, '', body),
  patch:  (table, query, body) => request('PATCH',  table, query, body),
  delete: (table, query)       => request('DELETE', table, query),
};

export function buildDateFilter(days) {
  if (days === 1) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export function fmt(n) { return Math.round(n).toLocaleString('en-IN'); }
export function fmtCurrency(n) { return '₹' + fmt(n); }
