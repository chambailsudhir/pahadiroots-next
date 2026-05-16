'use client';
// ── PriceSchedulePanel — Issue #19: Scheduled pricing ────────────────────────
// Schedule a price change to go live at a future date/time.
// Uses pricing_schedules table + activate_pricing_schedules() pg_cron job.

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { psychologicalRound } from '@/lib/pricingCalc';

const ri  = n => Math.round(Number(n) || 0);
const r2  = n => Math.round((Number(n) || 0) * 100) / 100;
const fmtR = n => '₹' + ri(n).toLocaleString('en-IN');

// Format ISO datetime for <input type="datetime-local">
function toLocalInput(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toISOString().slice(0, 16);
}
function toISO(localStr) {
  if (!localStr) return null;
  return new Date(localStr).toISOString();
}

const CHANNEL_OPTS = [
  { id: 'd2c',       label: 'D2C (main product price)' },
  { id: 'amazon',    label: 'Amazon' },
  { id: 'flipkart',  label: 'Flipkart' },
  { id: 'meesho',    label: 'Meesho' },
  { id: 'wholesale', label: 'Wholesale' },
];

export default function PriceSchedulePanel({ productId, currentSellingPrice, currentMrp, currentCompareAt }) {
  const [schedules, setSchedules] = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [form,      setForm]      = useState({
    channel:          'd2c',
    selling_price:    currentSellingPrice || '',
    compare_at_price: currentCompareAt || '',
    mrp:              currentMrp || '',
    valid_from:       '',
    valid_until:      '',
    notes:            '',
  });

  // Load existing schedules
  useEffect(() => {
    if (!productId) return;
    setLoading(true);
    api.get('pricing_schedules',
      `product_id=eq.${productId}&order=valid_from.asc&status=neq.cancelled`)
      .then(data => setSchedules(data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [productId]);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  async function schedule() {
    if (!productId) { alert('Save the product first.'); return; }
    if (!form.selling_price || !form.valid_from) {
      alert('Selling price and start date are required.'); return;
    }

    const newFrom  = new Date(form.valid_from).getTime();
    const newUntil = form.valid_until ? new Date(form.valid_until).getTime() : Infinity;

    // Client-side overlap guard — catches the conflict before hitting the DB trigger.
    // The DB trigger (check_schedule_no_overlap) is the authoritative enforcement;
    // this is a fast UX layer that saves a round-trip and shows a clear message.
    const conflict = schedules.find(s => {
      if (s.status === 'cancelled' || s.status === 'expired') return false;
      if (s.channel !== form.channel) return false;
      const sFrom  = new Date(s.valid_from).getTime();
      const sUntil = s.valid_until ? new Date(s.valid_until).getTime() : Infinity;
      // Overlap condition: ranges intersect
      return newFrom < sUntil && newUntil > sFrom;
    });

    if (conflict) {
      const conflictFrom  = new Date(conflict.valid_from).toLocaleString('en-IN');
      const conflictUntil = conflict.valid_until
        ? new Date(conflict.valid_until).toLocaleString('en-IN')
        : 'open-ended';
      alert(
        `⚠️ Schedule conflict!\n\n` +
        `A ${conflict.status} schedule for "${conflict.channel}" already exists:\n` +
        `${conflictFrom} → ${conflictUntil}\n\n` +
        `Your new schedule overlaps it. Cancel the existing schedule first, ` +
        `or adjust the dates so they don't overlap.`
      );
      return;
    }
    setSaving(true);
    try {
      const body = {
        product_id:       productId,
        channel:          form.channel,
        selling_price:    r2(form.selling_price),
        compare_at_price: form.compare_at_price ? r2(form.compare_at_price) : null,
        mrp:              form.mrp ? r2(form.mrp) : null,
        valid_from:       toISO(form.valid_from),
        valid_until:      form.valid_until ? toISO(form.valid_until) : null,
        notes:            form.notes || null,
        status:           'pending',
      };
      const result = await api.post('pricing_schedules', body);
      setSchedules(prev => [...prev, result?.[0] || body]);
      // Reset form
      setForm(f => ({ ...f, valid_from: '', valid_until: '', notes: '' }));
      alert('✅ Price change scheduled! It will activate automatically on the set date.');
    } catch(e) {
      alert('Schedule failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function cancelSchedule(id) {
    if (!confirm('Cancel this scheduled price change?')) return;
    try {
      await api.patch('pricing_schedules', `id=eq.${id}`, { status: 'cancelled' });
      setSchedules(prev => prev.map(s => s.id === id ? { ...s, status: 'cancelled' } : s));
    } catch(e) { alert('Cancel failed: ' + e.message); }
  }

  const statusColor = { pending: '#d29922', active: '#3fb950', expired: '#8b949e', cancelled: '#f85149' };

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--tx2)', marginBottom: 4 }}>
        ⏰ Schedule a Price Change
      </div>
      <div style={{ fontSize: 11, color: 'var(--tx3)', marginBottom: 16 }}>
        Set a future price change. It activates automatically at the chosen time.
        Requires pg_cron enabled in Supabase (see SQL migration notes).
      </div>

      {/* New schedule form */}
      <div style={{ borderRadius: 10, border: '1px solid var(--bd)', padding: '14px', marginBottom: 16, background: 'var(--bg2)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx)', marginBottom: 12 }}>New scheduled change</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--tx3)', marginBottom: 3 }}>Channel</div>
            <select value={form.channel} onChange={e => set('channel', e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg)', border: '1px solid var(--bd)', color: 'var(--tx)' }}>
              {CHANNEL_OPTS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--tx3)', marginBottom: 3 }}>New selling price ₹ *</div>
            <input type="number" value={form.selling_price} onChange={e => set('selling_price', e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: 'var(--bg)', border: '1px solid var(--bd)', color: 'var(--accent)', textAlign: 'right' }} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--tx3)', marginBottom: 3 }}>Compare at price ₹</div>
            <input type="number" value={form.compare_at_price} onChange={e => set('compare_at_price', e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg)', border: '1px solid var(--bd)', color: 'var(--tx)', textAlign: 'right' }} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--tx3)', marginBottom: 3 }}>MRP ₹</div>
            <input type="number" value={form.mrp} onChange={e => set('mrp', e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg)', border: '1px solid var(--bd)', color: 'var(--tx)', textAlign: 'right' }} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--tx3)', marginBottom: 3 }}>Go live at *</div>
            <input type="datetime-local" value={form.valid_from} onChange={e => set('valid_from', e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 11, background: 'var(--bg)', border: '1px solid var(--bd)', color: 'var(--tx)' }} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--tx3)', marginBottom: 3 }}>Revert at (optional)</div>
            <input type="datetime-local" value={form.valid_until} onChange={e => set('valid_until', e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 11, background: 'var(--bg)', border: '1px solid var(--bd)', color: 'var(--tx)' }} />
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--tx3)', marginBottom: 3 }}>Notes (e.g. "Diwali sale", "Flash sale")</div>
          <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional note…"
            style={{ width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 11, background: 'var(--bg)', border: '1px solid var(--bd)', color: 'var(--tx)' }} />
        </div>

        <button onClick={schedule} disabled={saving || !productId}
          style={{ width: '100%', padding: '8px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none', background: saving ? '#333' : 'var(--accent,#1a5c2a)', color: '#fff' }}>
          {saving ? 'Scheduling…' : '⏰ Schedule Price Change'}
        </button>
      </div>

      {/* Existing schedules */}
      {loading ? (
        <div style={{ fontSize: 11, color: 'var(--tx3)', textAlign: 'center', padding: 12 }}>Loading schedules…</div>
      ) : schedules.length > 0 ? (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--tx3)', marginBottom: 8 }}>Scheduled changes</div>
          {schedules.map(s => (
            <div key={s.id || s.valid_from} style={{ marginBottom: 8, padding: '10px 12px', borderRadius: 8, background: 'var(--bg2)', border: '1px solid var(--bd)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>{fmtR(s.selling_price)}</span>
                    <span style={{ fontSize: 10, color: 'var(--tx3)' }}>{s.channel}</span>
                    <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 99, fontWeight: 600, background: `${statusColor[s.status]}22`, color: statusColor[s.status] }}>{s.status}</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--tx3)' }}>
                    {new Date(s.valid_from).toLocaleString('en-IN')}
                    {s.valid_until && ` → ${new Date(s.valid_until).toLocaleString('en-IN')}`}
                  </div>
                  {s.notes && <div style={{ fontSize: 10, color: 'var(--tx2)', marginTop: 2 }}>{s.notes}</div>}
                </div>
                {s.status === 'pending' && (
                  <button onClick={() => cancelSchedule(s.id)}
                    style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.25)', color: '#f85149', cursor: 'pointer', flexShrink: 0 }}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--tx3)', textAlign: 'center', padding: 12 }}>No scheduled price changes.</div>
      )}
    </div>
  );
}
