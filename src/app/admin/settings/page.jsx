'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { Loader, Card } from '@/components/ui/index';

// ─── Helpers ────────────────────────────────────────────────────────────────
async function loadAllSettings() {
  const rows = await api.get('site_settings', 'select=key,value').catch(() => []);
  return Object.fromEntries((rows || []).map(r => [r.key, r.value]));
}

async function saveSetting(key, value) {
  const ex = await api.get('site_settings', `key=eq.${encodeURIComponent(key)}&limit=1`).catch(() => []);
  if (ex?.length) await api.patch('site_settings', `key=eq.${encodeURIComponent(key)}`, { value });
  else            await api.post('site_settings', { key, value });
}

async function saveMany(pairs) {
  for (const [k, v] of pairs) await saveSetting(k, v);
}

// ─── Reusable Components ─────────────────────────────────────────────────────
function FieldRow({ label, hint, children }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-4 items-start py-3"
      style={{ borderBottom: '1px solid var(--bd)' }}>
      <div>
        <div className="text-[12px] font-semibold" style={{ color: 'var(--tx)' }}>{label}</div>
        {hint && <div className="text-[10px] mt-0.5" style={{ color: 'var(--tx2)' }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Input({ value, onChange, placeholder, type = 'text', prefix, suffix }) {
  return (
    <div className="flex items-center rounded-lg overflow-hidden"
      style={{ border: '1px solid var(--bd)', background: 'var(--bg)' }}>
      {prefix && (
        <span className="px-2.5 text-[11px] font-semibold shrink-0" style={{ color: 'var(--tx2)', background: 'var(--bg2)', borderRight: '1px solid var(--bd)' }}>
          {prefix}
        </span>
      )}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 px-3 py-2 text-[12px] outline-none bg-transparent"
        style={{ color: 'var(--tx)' }}
      />
      {suffix && (
        <span className="px-2.5 text-[11px] font-semibold shrink-0" style={{ color: 'var(--tx2)', background: 'var(--bg2)', borderLeft: '1px solid var(--bd)' }}>
          {suffix}
        </span>
      )}
    </div>
  );
}

function Toggle({ value, onChange, label, description }) {
  const on = value === 'true' || value === true;
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-[12px] font-semibold" style={{ color: 'var(--tx)' }}>{label}</div>
        {description && <div className="text-[10px] mt-0.5" style={{ color: 'var(--tx2)' }}>{description}</div>}
      </div>
      <button
        onClick={() => onChange(on ? 'false' : 'true')}
        className="relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200"
        style={{ background: on ? 'var(--accent)' : 'var(--bd)' }}>
        <span
          className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 mt-0.5"
          style={{ transform: on ? 'translateX(18px)' : 'translateX(2px)' }}
        />
      </button>
    </div>
  );
}

function SaveBtn({ onClick, saving, saved, label = 'Save Changes' }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className="px-5 py-2 rounded-lg text-[12px] font-bold transition"
      style={{
        background: saved ? 'rgba(63,185,80,0.15)' : 'color-mix(in srgb, var(--accent) 18%, transparent)',
        color: saved ? '#3fb950' : 'var(--accent)',
        border: `1px solid ${saved ? '#3fb950' : 'color-mix(in srgb, var(--accent) 35%, transparent)'}`,
        opacity: saving ? 0.6 : 1,
      }}>
      {saving ? '⏳ Saving…' : saved ? '✅ Saved!' : `💾 ${label}`}
    </button>
  );
}

// ─── Section: Shipping ───────────────────────────────────────────────────────
function ShippingSection({ settings, onSaved }) {
  const [freeMin,    setFreeMin]    = useState('');
  const [flatCharge, setFlatCharge] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  useEffect(() => {
    setFreeMin(settings.free_shipping_min     ?? '799');
    setFlatCharge(settings.flat_shipping_charge ?? '99');
  }, [settings]);

  async function save() {
    setSaving(true); setSaved(false);
    try {
      await saveMany([
        ['free_shipping_min',    freeMin.trim()],
        ['flat_shipping_charge', flatCharge.trim()],
      ]);
      setSaved(true); setTimeout(() => setSaved(false), 3000); onSaved?.();
    } catch (e) { alert('Save failed: ' + e.message); }
    setSaving(false);
  }

  return (
    <Card title="🚚 Shipping & Delivery">
      <div className="space-y-0">
        <FieldRow label="Free Shipping Above" hint="Orders above this get free shipping (₹). Set 0 for always free.">
          <Input value={freeMin} onChange={setFreeMin} placeholder="799" type="number" prefix="₹" />
        </FieldRow>
        <FieldRow label="Flat Shipping Fee" hint="Charged when order is below free-shipping threshold.">
          <Input value={flatCharge} onChange={setFlatCharge} placeholder="99" type="number" prefix="₹" />
        </FieldRow>
        <div className="pt-4">
          <SaveBtn onClick={save} saving={saving} saved={saved} label="Save Shipping" />
        </div>
      </div>
    </Card>
  );
}

// ─── Section: Contact & WhatsApp ─────────────────────────────────────────────
function ContactSection({ settings, onSaved }) {
  const [whatsapp,   setWhatsapp]   = useState('');
  const [email,      setEmail]      = useState('');
  const [phone,      setPhone]      = useState('');
  const [address,    setAddress]    = useState('');
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  useEffect(() => {
    setWhatsapp(settings.whatsapp_number ?? '');
    setEmail(settings.contact_email     ?? '');
    setPhone(settings.contact_phone     ?? '');
    setAddress(settings.contact_address ?? '');
  }, [settings]);

  async function save() {
    setSaving(true); setSaved(false);
    try {
      await saveMany([
        ['whatsapp_number',  whatsapp.trim()],
        ['contact_email',    email.trim()],
        ['contact_phone',    phone.trim()],
        ['contact_address',  address.trim()],
      ]);
      setSaved(true); setTimeout(() => setSaved(false), 3000); onSaved?.();
    } catch (e) { alert('Save failed: ' + e.message); }
    setSaving(false);
  }

  return (
    <Card title="📞 Contact & WhatsApp — wires to footer on live site">
      <div className="space-y-0">
        <FieldRow label="WhatsApp Number" hint="Used for WhatsApp COD orders. Include country code.">
          <Input value={whatsapp} onChange={setWhatsapp} placeholder="+919876543210" prefix="WA" />
        </FieldRow>
        <FieldRow label="Contact Email" hint="Shown on contact/footer pages.">
          <Input value={email} onChange={setEmail} placeholder="hello@pahadiroots.com" type="email" />
        </FieldRow>
        <FieldRow label="Contact Phone" hint="Display phone number on website.">
          <Input value={phone} onChange={setPhone} placeholder="+91 98765 43210" />
        </FieldRow>
        <FieldRow label="Business Address" hint="Shown in footer & order invoices.">
          <textarea
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="123 Mountain Road, Uttarakhand 249201"
            rows={2}
            className="w-full rounded-lg px-3 py-2 text-[12px] outline-none resize-none"
            style={{ background: 'var(--bg)', border: '1px solid var(--bd)', color: 'var(--tx)' }}
          />
        </FieldRow>
        <div className="pt-4">
          <SaveBtn onClick={save} saving={saving} saved={saved} label="Save Contact Info" />
        </div>
      </div>
    </Card>
  );
}

// ─── Section: Social Links ────────────────────────────────────────────────────
function SocialSection({ settings, onSaved }) {
  const [instagram, setInstagram] = useState('');
  const [facebook,  setFacebook]  = useState('');
  const [twitter,   setTwitter]   = useState('');
  const [youtube,   setYoutube]   = useState('');
  const [pinterest, setPinterest] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  useEffect(() => {
    setInstagram(settings.social_instagram ?? '');
    setFacebook(settings.social_facebook   ?? '');
    setTwitter(settings.social_twitter     ?? '');
    setYoutube(settings.social_youtube     ?? '');
    setPinterest(settings.social_pinterest ?? '');
  }, [settings]);

  async function save() {
    setSaving(true); setSaved(false);
    try {
      await saveMany([
        ['social_instagram', instagram.trim()],
        ['social_facebook',  facebook.trim()],
        ['social_twitter',   twitter.trim()],
        ['social_youtube',   youtube.trim()],
        ['social_pinterest', pinterest.trim()],
      ]);
      setSaved(true); setTimeout(() => setSaved(false), 3000); onSaved?.();
    } catch (e) { alert('Save failed: ' + e.message); }
    setSaving(false);
  }

  const socials = [
    ['Instagram', '📸', instagram, setInstagram, 'https://instagram.com/pahadiroots'],
    ['Facebook',  '📘', facebook,  setFacebook,  'https://facebook.com/pahadiroots'],
    ['Twitter/X', '🐦', twitter,   setTwitter,   'https://twitter.com/pahadiroots'],
    ['YouTube',   '▶️', youtube,   setYoutube,   'https://youtube.com/@pahadiroots'],
    ['Pinterest', '📌', pinterest, setPinterest, 'https://pinterest.com/pahadiroots'],
  ];

  return (
    <Card title="🔗 Social Media Links — wires to footer icons on live site">
      <div className="space-y-0">
        {socials.map(([label, icon, val, set, ph]) => (
          <FieldRow key={label} label={`${icon} ${label}`}>
            <Input value={val} onChange={set} placeholder={ph} prefix="URL" />
          </FieldRow>
        ))}
        <div className="pt-4">
          <SaveBtn onClick={save} saving={saving} saved={saved} label="Save Social Links" />
        </div>
      </div>
    </Card>
  );
}

// ─── Section: SEO / Meta ─────────────────────────────────────────────────────
function SeoSection({ settings, onSaved }) {
  const [siteName,     setSiteName]     = useState('');
  const [metaTitle,    setMetaTitle]    = useState('');
  const [metaDesc,     setMetaDesc]     = useState('');
  const [ogImage,      setOgImage]      = useState('');
  const [googleTag,    setGoogleTag]    = useState('');
  const [metaKeywords, setMetaKeywords] = useState('');
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError,   setAiError]   = useState('');
  const [aiHint,    setAiHint]    = useState('');

  useEffect(() => {
    setSiteName(settings.site_name        ?? 'Pahadi Roots');
    setMetaTitle(settings.meta_title      ?? '');
    setMetaDesc(settings.meta_description ?? '');
    setOgImage(settings.og_image          ?? '');
    setGoogleTag(settings.google_tag_id   ?? '');
    setMetaKeywords(settings.meta_keywords ?? '');
  }, [settings]);

  async function save() {
    setSaving(true); setSaved(false);
    try {
      await saveMany([
        ['site_name',        siteName.trim()],
        ['meta_title',       metaTitle.trim()],
        ['meta_description', metaDesc.trim()],
        ['og_image',         ogImage.trim()],
        ['google_tag_id',    googleTag.trim()],
        ['meta_keywords',    metaKeywords.trim()],
      ]);
      setSaved(true); setTimeout(() => setSaved(false), 3000); onSaved?.();
    } catch (e) { alert('Save failed: ' + e.message); }
    setSaving(false);
  }

  async function generateWithAI() {
    setAiLoading(true); setAiError(''); setAiHint('');
    try {
      // Fetch real products for context
      const products = await api.get('products', 'select=name&status=eq.active&is_deleted=eq.false&limit=15').catch(() => []);
      const productNames = (products || []).map(p => p.name).join(', ');

      // Call via admin API route (uses ANTHROPIC_API_KEY from Vercel env)
      const pw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('pr_pw') : '';
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': pw || '' },
        body: JSON.stringify({ action: 'generate_seo', siteName: siteName || 'Pahadi Roots', productNames }),
      });

      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);

      const seo = data.seo;
      if (seo.meta_title)       setMetaTitle(seo.meta_title);
      if (seo.meta_description) setMetaDesc(seo.meta_description);
      if (seo.meta_keywords)    setMetaKeywords(seo.meta_keywords);
      if (seo.suggestion)       setAiHint(seo.suggestion);
    } catch (e) {
      setAiError('Error: ' + (e.message || 'Unknown — check browser console'));
      console.error('SEO AI error:', e);
    }
    setAiLoading(false);
  }

  return (
    <Card title="🔍 SEO & Meta Tags">
      <div className="space-y-0">
        <div className="mb-2 px-3 py-3 rounded-lg text-[11px] space-y-1" style={{ background: 'rgba(210,153,34,0.07)', border: '1px solid rgba(210,153,34,0.25)', color: '#d29922' }}>
          <div className="font-bold text-[12px]">⚠️ How SEO works here</div>
          <div style={{ color: 'var(--tx2)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--tx)' }}>Visitors & JS:</strong> Updates instantly via main.js ✅ &nbsp;
            <strong style={{ color: 'var(--tx)' }}>Google crawler:</strong> Also update index.html for permanent ranking &nbsp;
            <strong style={{ color: 'var(--tx)' }}>Google Tag ID:</strong> GA4 loads automatically ✅
          </div>
        </div>

        {/* AI Generator */}
        <div className="py-4" style={{ borderBottom: '1px solid var(--bd)' }}>
          <div className="rounded-xl p-4 space-y-3" style={{ background: 'color-mix(in srgb, var(--accent) 6%, transparent)', border: '1.5px solid color-mix(in srgb, var(--accent) 28%, transparent)' }}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-bold" style={{ color: 'var(--tx)' }}>🤖 AI SEO Generator</div>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--tx2)' }}>Reads your actual products → generates optimised title, description & keywords automatically. Review before saving.</div>
              </div>
              <button onClick={generateWithAI} disabled={aiLoading}
                className="px-4 py-2 rounded-lg text-[12px] font-bold shrink-0 flex items-center gap-2"
                style={{ background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)', opacity: aiLoading ? 0.7 : 1 }}>
                {aiLoading ? <><div className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--bd)', borderTopColor: 'var(--accent)' }} />Generating…</> : '✨ Generate with AI'}
              </button>
            </div>
            {aiHint && <div className="px-3 py-2 rounded-lg text-[11px]" style={{ background: 'rgba(63,185,80,0.08)', border: '1px solid rgba(63,185,80,0.2)', color: '#3fb950' }}>💡 <strong>AI tip:</strong> {aiHint}</div>}
            {aiError && <div className="px-3 py-2 rounded-lg text-[11px]" style={{ background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.2)', color: '#f85149' }}>⚠️ {aiError}</div>}
          </div>
        </div>

        <FieldRow label="Site Name" hint="Browser tab & og:site_name">
          <Input value={siteName} onChange={setSiteName} placeholder="Pahadi Roots" />
        </FieldRow>
        <FieldRow label="Meta Title" hint="~60 chars ideal for Google">
          <div className="space-y-1">
            <Input value={metaTitle} onChange={setMetaTitle} placeholder="Pahadi Roots — Pure Himalayan Products" />
            <div className="text-[10px]" style={{ color: metaTitle.length > 65 ? '#f85149' : 'var(--tx2)' }}>{metaTitle.length}/65 chars</div>
          </div>
        </FieldRow>
        <FieldRow label="Meta Description" hint="Shown in Google search. ~155 chars ideal.">
          <div className="space-y-1">
            <textarea value={metaDesc} onChange={e => setMetaDesc(e.target.value)}
              placeholder="Shop pure Himalayan herbs, spices & superfoods sourced directly from mountain farmers."
              rows={3} className="w-full rounded-lg px-3 py-2 text-[12px] outline-none resize-none"
              style={{ background: 'var(--bg)', border: '1px solid var(--bd)', color: 'var(--tx)' }} />
            <div className="text-[10px]" style={{ color: metaDesc.length > 160 ? '#f85149' : 'var(--tx2)' }}>{metaDesc.length}/160 chars</div>
          </div>
        </FieldRow>
        <FieldRow label="Meta Keywords" hint="Comma-separated. AI generates 15-20 relevant ones.">
          <Input value={metaKeywords} onChange={setMetaKeywords} placeholder="himalayan herbs, pahadi products, organic spices…" />
        </FieldRow>
        <FieldRow label="OG Share Image" hint="WhatsApp/Facebook share preview. 1200×630px ideal.">
          <Input value={ogImage} onChange={setOgImage} placeholder="https://..." prefix="URL" />
        </FieldRow>
        <FieldRow label="Google Tag ID" hint="G-XXXXXXX or GTM-XXXXXX — GA4 loads automatically.">
          <Input value={googleTag} onChange={setGoogleTag} placeholder="G-XXXXXXXXXX" />
        </FieldRow>
        <div className="pt-4">
          <SaveBtn onClick={save} saving={saving} saved={saved} label="Save SEO Settings" />
        </div>
      </div>
    </Card>
  );
}

// ─── Section: Order & Payment ─────────────────────────────────────────────────
function OrderSection({ settings, onSaved }) {
  const [minOrderAmt, setMinOrderAmt] = useState('');
  const [upiEnabled,  setUpiEnabled]  = useState('true');
  const [codEnabled,  setCodEnabled]  = useState('true');
  const [orderPrefix, setOrderPrefix] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  useEffect(() => {
    setMinOrderAmt(settings.min_order_amount ?? '0');
    setUpiEnabled(settings.upi_enabled       ?? 'true');
    setCodEnabled(settings.cod_enabled       ?? 'true');
    setOrderPrefix(settings.order_prefix     ?? 'PR');
  }, [settings]);

  async function save() {
    setSaving(true); setSaved(false);
    try {
      await saveMany([
        ['min_order_amount', minOrderAmt.trim()],
        ['order_prefix',     orderPrefix.trim()],
        ['upi_enabled',      upiEnabled],
        ['cod_enabled',      codEnabled],
      ]);
      setSaved(true); setTimeout(() => setSaved(false), 3000); onSaved?.();
    } catch (e) { alert('Save failed: ' + e.message); }
    setSaving(false);
  }

  const bothOff = upiEnabled === 'false' && codEnabled === 'false';

  return (
    <Card title="🛒 Orders & Payments">
      <div className="space-y-0">
        {/* Info box about GST */}
        <div className="mb-1 px-3 py-2.5 rounded-lg text-[11px]" style={{ background: 'rgba(88,166,255,0.07)', border: '1px solid rgba(88,166,255,0.18)', color: '#58a6ff' }}>
          ℹ️ <strong>GST is managed per-product</strong> in Catalogue → each product has its own GST rate (0%, 5%, 12%, 18%). GST is already included in the selling price shown to customers — no global toggle needed here.
        </div>
        <FieldRow label="Min Order Amount" hint="Block checkout if cart total is below this. Set 0 to disable.">
          <Input value={minOrderAmt} onChange={setMinOrderAmt} placeholder="0" type="number" prefix="₹" />
        </FieldRow>
        <FieldRow label="Order ID Prefix" hint="Prefix added to order numbers (e.g. PR-1001).">
          <Input value={orderPrefix} onChange={setOrderPrefix} placeholder="PR" suffix="-1001" />
        </FieldRow>
        <FieldRow label="UPI / Card Payments">
          <div className="space-y-2">
            <Toggle value={upiEnabled} onChange={setUpiEnabled} label="Enable Razorpay (UPI / Cards)" description="Shows/hides the online payment button at checkout" />
            {upiEnabled === 'false' && (
              <div className="px-3 py-2 rounded-lg text-[10.5px]" style={{ background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.2)', color: '#f85149' }}>
                ⚠️ Razorpay button hidden on live site. Only COD will be available.
              </div>
            )}
          </div>
        </FieldRow>
        <FieldRow label="COD / WhatsApp">
          <div className="space-y-2">
            <Toggle value={codEnabled} onChange={setCodEnabled} label='Enable COD + WhatsApp Order' description="Shows/hides the COD & WhatsApp confirm button at checkout" />
            {codEnabled === 'false' && (
              <div className="px-3 py-2 rounded-lg text-[10.5px]" style={{ background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.2)', color: '#f85149' }}>
                ⚠️ COD button hidden on live site. Only online payment will be available.
              </div>
            )}
          </div>
        </FieldRow>
        {bothOff && (
          <div className="px-3 py-2.5 rounded-lg text-[11px] font-semibold" style={{ background: 'rgba(248,81,73,0.12)', border: '1px solid rgba(248,81,73,0.35)', color: '#f85149' }}>
            🚨 Both payment methods are OFF — customers cannot checkout at all!
          </div>
        )}
        <div className="pt-4">
          <SaveBtn onClick={save} saving={saving} saved={saved} label="Save Order Settings" />
        </div>
      </div>
    </Card>
  );
}

// ─── Section: Store Status ────────────────────────────────────────────────────
function StoreStatusSection({ settings, onSaved }) {
  const [storeOpen, setStoreOpen] = useState('true');
  const [maintenanceMsg, setMaintenanceMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  useEffect(() => {
    setStoreOpen(settings.store_open ?? 'true');
    setMaintenanceMsg(settings.maintenance_message ?? "We'll be back soon! 🌿");
  }, [settings]);

  async function save() {
    setSaving(true); setSaved(false);
    try {
      await saveMany([
        ['store_open',          storeOpen],
        ['maintenance_message', maintenanceMsg.trim()],
      ]);
      setSaved(true); setTimeout(() => setSaved(false), 3000); onSaved?.();
    } catch (e) { alert('Save failed: ' + e.message); }
    setSaving(false);
  }

  return (
    <Card title="🏪 Store Status">
      <div className="space-y-0">

        {/* How it works info box */}
        <div className="mb-2 px-3 py-3 rounded-lg text-[11px] space-y-1.5" style={{ background: 'rgba(63,185,80,0.07)', border: '1px solid rgba(63,185,80,0.2)', color: '#3fb950' }}>
          <div className="font-bold text-[12px]">✅ Store Close is fully wired</div>
          <div style={{ color: 'var(--tx2)' }}>
            Turning the store OFF replaces the entire site with a maintenance page instantly. Customers cannot browse or order. Turning it back ON restores the site immediately.
          </div>
        </div>

        <FieldRow label="Store Status">
          <div className="space-y-2">
            <Toggle
              value={storeOpen}
              onChange={setStoreOpen}
              label={storeOpen === 'true' ? '🟢 Store is Open' : '🔴 Store is Closed'}
              description="Live site goes into maintenance mode instantly when closed"
            />
            {storeOpen === 'false' && (
              <div className="px-3 py-2.5 rounded-lg text-[10.5px]" style={{ background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.2)', color: '#f85149' }}>
                🔴 <strong>Store is CLOSED.</strong> Live site shows maintenance page. Customers cannot browse or order.
              </div>
            )}
          </div>
        </FieldRow>

        {storeOpen === 'false' && (
          <FieldRow label="Maintenance Message" hint="Shown on maintenance page (once wired in main.js).">
            <Input value={maintenanceMsg} onChange={setMaintenanceMsg} placeholder="We'll be back soon! 🌿" />
          </FieldRow>
        )}

        {/* Future-ready toggles */}
        <div className="py-3" style={{ borderBottom: '1px solid var(--bd)' }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(210,153,34,0.15)', color: '#d29922' }}>🔮 COMING SOON</span>
            <span className="text-[11px]" style={{ color: 'var(--tx2)' }}>These will be wired to the live site in a future update</span>
          </div>
          <div className="space-y-3 opacity-60">
            <div className="flex items-center justify-between px-3 py-2.5 rounded-lg" style={{ background: 'var(--bg)', border: '1px dashed var(--bd)' }}>
              <div>
                <div className="text-[12px] font-semibold" style={{ color: 'var(--tx)' }}>🌱 New Arrivals Section</div>
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--tx2)' }}>Show/hide New Arrivals on homepage — section coming to live site soon</div>
              </div>
              <div className="h-5 w-9 rounded-full flex items-center px-0.5" style={{ background: 'var(--bd)' }}>
                <span className="inline-block h-4 w-4 rounded-full bg-white shadow" />
              </div>
            </div>
            <div className="flex items-center justify-between px-3 py-2.5 rounded-lg" style={{ background: 'var(--bg)', border: '1px dashed var(--bd)' }}>
              <div>
                <div className="text-[12px] font-semibold" style={{ color: 'var(--tx)' }}>⭐ Customer Reviews</div>
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--tx2)' }}>Enable/disable product reviews — reviews section coming to live site soon</div>
              </div>
              <div className="h-5 w-9 rounded-full flex items-center px-0.5" style={{ background: 'var(--bd)' }}>
                <span className="inline-block h-4 w-4 rounded-full bg-white shadow" />
              </div>
            </div>
          </div>
        </div>

        <div className="pt-4">
          <SaveBtn onClick={save} saving={saving} saved={saved} label="Save Store Status" />
        </div>
      </div>
    </Card>
  );
}

// ─── Section: Email & Notifications ─────────────────────────────────────────
function EmailSection({ settings, onSaved }) {
  const [orderEmailEnabled, setOrderEmailEnabled] = useState('true');
  const [notifyEmail,       setNotifyEmail]       = useState('');
  const [emailFooterText,   setEmailFooterText]   = useState('');
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  useEffect(() => {
    setOrderEmailEnabled(settings.order_email_enabled ?? 'true');
    setNotifyEmail(settings.admin_notify_email        ?? '');
    setEmailFooterText(settings.email_footer_text     ?? '');
  }, [settings]);

  async function save() {
    setSaving(true); setSaved(false);
    try {
      await saveMany([
        ['order_email_enabled', orderEmailEnabled],
        ['admin_notify_email',  notifyEmail.trim()],
        ['email_footer_text',   emailFooterText.trim()],
      ]);
      setSaved(true); setTimeout(() => setSaved(false), 3000); onSaved?.();
    } catch (e) { alert('Save failed: ' + e.message); }
    setSaving(false);
  }

  return (
    <Card title="📧 Email & Notifications">
      <div className="space-y-0">
        {/* Email system info */}
        <div className="mb-2 px-3 py-3 rounded-lg text-[11px] space-y-1.5" style={{ background: 'rgba(88,166,255,0.07)', border: '1px solid rgba(88,166,255,0.18)' }}>
          <div className="font-bold text-[12px]" style={{ color: '#58a6ff' }}>ℹ️ How emails work on Pahadi Roots</div>
          <div style={{ color: 'var(--tx2)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--tx)' }}>Sent from:</strong> <code className="px-1 rounded text-[10px]" style={{ background: 'var(--bg)' }}>noreply@pahadiroots.com</code> via <strong style={{ color: 'var(--tx)' }}>Resend</strong> (Vercel env) ✅<br/>
            <strong style={{ color: 'var(--tx)' }}>Order Confirmation toggle:</strong> Wired — turning OFF stops all customer emails ✅<br/>
            <strong style={{ color: 'var(--tx)' }}>Admin Notify Email:</strong> Overrides Vercel default, alert goes to this address ✅<br/>
            <strong style={{ color: 'var(--tx)' }}>Email Footer Text:</strong> Appears at bottom of every outgoing email ✅
          </div>
        </div>
        <FieldRow label="Order Confirmation Emails">
          <Toggle value={orderEmailEnabled} onChange={setOrderEmailEnabled} label="Send order emails to customers" description="Sends confirmation email on every new order" />
        </FieldRow>
        <FieldRow label="Admin Notify Email" hint="Admin receives order alerts at this address.">
          <Input value={notifyEmail} onChange={setNotifyEmail} placeholder="admin@pahadiroots.com" type="email" />
        </FieldRow>
        <FieldRow label="Email Footer Text" hint="Appears at the bottom of all outgoing emails.">
          <Input value={emailFooterText} onChange={setEmailFooterText} placeholder="© 2024 Pahadi Roots. All rights reserved." />
        </FieldRow>
        <div className="pt-4">
          <SaveBtn onClick={save} saving={saving} saved={saved} label="Save Email Settings" />
        </div>
      </div>
    </Card>
  );
}

// ─── Section: Raw Settings Inspector ─────────────────────────────────────────
function RawSettingsViewer({ settings }) {
  const [open, setOpen] = useState(false);
  const pairs = Object.entries(settings || {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <Card title="🔬 All Settings (Raw)">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px]" style={{ color: 'var(--tx2)' }}>
            {pairs.length} setting{pairs.length !== 1 ? 's' : ''} stored in <code className="text-[10px] px-1 py-0.5 rounded" style={{ background: 'var(--bg)', color: 'var(--accent)' }}>site_settings</code> table.
          </p>
          <button
            onClick={() => setOpen(o => !o)}
            className="text-[11px] px-3 py-1 rounded-lg font-semibold"
            style={{ background: 'var(--bg)', border: '1px solid var(--bd)', color: 'var(--tx2)' }}>
            {open ? '▲ Collapse' : '▼ Expand'}
          </button>
        </div>
        {open && (
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--bd)' }}>
            {pairs.length === 0 ? (
              <div className="px-4 py-6 text-center text-[12px]" style={{ color: 'var(--tx2)' }}>No settings yet.</div>
            ) : (
              pairs.map(([k, v], i) => (
                <div key={k} className="flex items-start gap-0 text-[11px]"
                  style={{ borderBottom: i < pairs.length - 1 ? '1px solid var(--bd)' : 'none', background: i % 2 === 0 ? 'transparent' : 'var(--bg)' }}>
                  <div className="w-52 shrink-0 px-3 py-2 font-mono font-semibold" style={{ color: 'var(--accent)', borderRight: '1px solid var(--bd)' }}>
                    {k}
                  </div>
                  <div className="flex-1 px-3 py-2 break-all font-mono" style={{ color: 'var(--tx2)' }}>
                    {String(v || '—')}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Tabs Nav ────────────────────────────────────────────────────────────────
// ─── Section: Announcement Bar ───────────────────────────────────────────────
function AnnBarSection({ settings, onSaved }) {
  const s = settings || {};
  const [hidden,  setHidden]  = useState(s.ann_hide === 'true');
  const [text,    setText]    = useState(s.ann_text || '');
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);

  async function save() {
    setSaving(true); setSaved(false);
    try {
      await saveMany([
        ['ann_hide', hidden ? 'true' : 'false'],
        ['ann_text', text.trim()],
      ]);
      setSaved(true); setTimeout(() => setSaved(false), 3000); onSaved();
    } catch(e) { alert('Save failed: ' + e.message); }
    setSaving(false);
  }

  return (
    <Card title="📢 Announcement Bar — Top green banner">
      <div className="p-5 space-y-4">
        <div className="text-[11px] p-3 rounded-xl" style={{ background: 'rgba(88,166,255,0.06)', border: '1px solid rgba(88,166,255,0.18)', color: 'var(--tx2)' }}>
          💡 The dark green bar at the very top of the site. Default shows free shipping amount, UPI/Cards/COD, and Himalayan States Covered.
        </div>
        <div className="flex items-center justify-between p-3 rounded-xl" style={{ background: 'var(--bg)', border: `1.5px solid ${hidden ? 'rgba(248,81,73,0.3)' : 'rgba(63,185,80,0.25)'}` }}>
          <div>
            <div className="text-[13px] font-bold" style={{ color: hidden ? '#f85149' : '#3fb950' }}>
              {hidden ? '🚫 Bar is hidden' : '✅ Bar is visible'}
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--tx2)' }}>Toggle to show/hide the entire announcement bar</div>
          </div>
          <button onClick={() => setHidden(h => !h)}
            className="px-4 py-2 rounded-lg text-[12px] font-bold transition"
            style={hidden
              ? { color: '#3fb950', border: '1px solid rgba(63,185,80,0.35)', background: 'rgba(63,185,80,0.1)' }
              : { color: '#f85149', border: '1px solid rgba(248,81,73,0.35)', background: 'rgba(248,81,73,0.1)' }}>
            {hidden ? '✓ Show Bar' : '👁 Hide Bar'}
          </button>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--tx2)' }}>Custom Text (optional)</div>
          <input value={text} onChange={e => setText(e.target.value)}
            placeholder="Leave blank to use default (shipping amount, UPI/COD, States Covered)"
            className="w-full rounded-lg px-3 py-2 text-[12px] outline-none"
            style={{ background: 'var(--bg)', border: '1px solid var(--bd)', color: 'var(--tx)' }} />
          <div className="text-[10px] mt-1" style={{ color: 'var(--tx2)', opacity: 0.7 }}>
            You can use HTML — e.g. <code style={{ background: 'var(--bd)', padding: '0 3px', borderRadius: 3 }}>&lt;a href="#pay-sec"&gt;UPI · Cards&lt;/a&gt;</code>
          </div>
        </div>
        <div className="flex justify-end"><SaveBtn onClick={save} saving={saving} saved={saved} label="Save Announcement Bar" /></div>
      </div>
    </Card>
  );
}

// ─── Section: Ticker Bar ──────────────────────────────────────────────────────
const TICKER_DEFAULTS = [
  '🎁 Use code WELCOME50 · ₹50 off your first order',
  '🚚 Free shipping · On orders above ₹799 — Pan India',
  '🌿 100% Natural · Lab-tested, pure',
  '🏔️ Direct from farmers · 200+ mountain families',
  '⭐ Rated 4.9/5 · 10,000+ happy customers',
];
function TickerSection({ settings, onSaved }) {
  const s = settings || {};
  const [hideAll, setHideAll] = useState(s.ticker_hide === 'true');
  const [items, setItems] = useState(
    TICKER_DEFAULTS.map((d, i) => ({
      text:   s[`ticker_${i+1}_text`]  || d,
      hidden: s[`ticker_${i+1}_hide`] === 'true',
    }))
  );
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  function update(i, field, val) { setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: val } : it)); }

  async function save() {
    setSaving(true); setSaved(false);
    try {
      const pairs = [['ticker_hide', hideAll ? 'true' : 'false']];
      items.forEach((it, i) => {
        pairs.push([`ticker_${i+1}_text`, it.text]);
        pairs.push([`ticker_${i+1}_hide`, it.hidden ? 'true' : 'false']);
      });
      await saveMany(pairs);
      setSaved(true); setTimeout(() => setSaved(false), 3000); onSaved();
    } catch(e) { alert('Save failed: ' + e.message); }
    setSaving(false);
  }

  return (
    <Card title="🎢 Ticker Bar — Scrolling orange marquee">
      <div className="p-5 space-y-4">
        <div className="text-[11px] p-3 rounded-xl" style={{ background: 'rgba(88,166,255,0.06)', border: '1px solid rgba(88,166,255,0.18)', color: 'var(--tx2)' }}>
          💡 The scrolling orange bar below the announcement bar. Edit each message, hide individual items, or hide the whole bar.
        </div>

        {/* Hide all toggle */}
        <div className="flex items-center justify-between p-3 rounded-xl" style={{ background: 'var(--bg)', border: `1.5px solid ${hideAll ? 'rgba(248,81,73,0.3)' : 'rgba(63,185,80,0.25)'}` }}>
          <div>
            <div className="text-[13px] font-bold" style={{ color: hideAll ? '#f85149' : '#3fb950' }}>
              {hideAll ? '🚫 Ticker is hidden' : '✅ Ticker is visible'}
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--tx2)' }}>Toggle to show/hide the entire scrolling ticker</div>
          </div>
          <button onClick={() => setHideAll(h => !h)}
            className="px-4 py-2 rounded-lg text-[12px] font-bold transition"
            style={hideAll
              ? { color: '#3fb950', border: '1px solid rgba(63,185,80,0.35)', background: 'rgba(63,185,80,0.1)' }
              : { color: '#f85149', border: '1px solid rgba(248,81,73,0.35)', background: 'rgba(248,81,73,0.1)' }}>
            {hideAll ? '✓ Show Ticker' : '👁 Hide Ticker'}
          </button>
        </div>

        {/* Individual items */}
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2 p-3 rounded-xl"
              style={{ background: it.hidden ? 'rgba(248,81,73,0.04)' : 'var(--bg)', border: `1.5px solid ${it.hidden ? 'rgba(248,81,73,0.2)' : 'var(--bd)'}`, opacity: it.hidden ? 0.6 : 1 }}>
              <span className="text-[10px] font-bold w-5 text-center flex-shrink-0" style={{ color: 'var(--tx2)' }}>{i+1}</span>
              <input value={it.text} onChange={e => update(i, 'text', e.target.value)}
                className="flex-1 rounded-lg px-2.5 py-1.5 text-[12px] outline-none"
                style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', color: 'var(--tx)' }} />
              <button onClick={() => update(i, 'hidden', !it.hidden)}
                className="text-[10px] px-2.5 py-1.5 rounded-lg font-semibold transition flex-shrink-0"
                style={it.hidden
                  ? { color: '#3fb950', border: '1px solid rgba(63,185,80,0.3)', background: 'rgba(63,185,80,0.08)' }
                  : { color: 'var(--tx2)', border: '1px solid var(--bd)', background: 'var(--bg2)' }}>
                {it.hidden ? '✓ Show' : '👁 Hide'}
              </button>
            </div>
          ))}
        </div>
        <div className="flex justify-end"><SaveBtn onClick={save} saving={saving} saved={saved} label="Save Ticker" /></div>
      </div>
    </Card>
  );
}

// ─── Section: Hero Stats Bar ──────────────────────────────────────────────────
function StatsSection({ settings, onSaved }) {
  const s = settings || {};
  const [farmers,   setFarmers]   = useState(s.stat_farmer_families  || '500');
  const [states,    setStates]    = useState(s.stat_himalayan_states  || '10');
  const [customers, setCustomers] = useState(s.stat_happy_customers   || '10000');
  const [dispatch,  setDispatch]  = useState(s.stat_avg_dispatch      || '48');
  const [farmersLbl,   setFarmersLbl]   = useState(s.stat_farmer_label    || 'Farmer Families');
  const [statesLbl,    setStatesLbl]    = useState(s.stat_states_label    || 'Himalayan States');
  const [customersLbl, setCustomersLbl] = useState(s.stat_customers_label || 'Happy Customers');
  const [dispatchLbl,  setDispatchLbl]  = useState(s.stat_dispatch_label  || 'Avg Dispatch');
  const [hideFarmers,   setHideFarmers]   = useState(s.stat_hide_stat_farmer_families  === 'true');
  const [hideStates,    setHideStates]    = useState(s.stat_hide_stat_himalayan_states  === 'true');
  const [hideCustomers, setHideCustomers] = useState(s.stat_hide_stat_happy_customers   === 'true');
  const [hideDispatch,  setHideDispatch]  = useState(s.stat_hide_stat_avg_dispatch      === 'true');
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  async function save() {
    setSaving(true); setSaved(false);
    try {
      await saveMany([
        ['stat_farmer_families',            farmers],
        ['stat_himalayan_states',           states],
        ['stat_happy_customers',            customers],
        ['stat_avg_dispatch',               dispatch],
        ['stat_farmer_label',               farmersLbl],
        ['stat_states_label',               statesLbl],
        ['stat_customers_label',            customersLbl],
        ['stat_dispatch_label',             dispatchLbl],
        ['stat_hide_stat_farmer_families',  hideFarmers   ? 'true' : 'false'],
        ['stat_hide_stat_himalayan_states', hideStates    ? 'true' : 'false'],
        ['stat_hide_stat_happy_customers',  hideCustomers ? 'true' : 'false'],
        ['stat_hide_stat_avg_dispatch',     hideDispatch  ? 'true' : 'false'],
      ]);
      setSaved(true); setTimeout(() => setSaved(false), 3000); onSaved();
    } catch(e) { alert('Save failed: ' + e.message); }
    setSaving(false);
  }

  function StatRow({ label, num, onNum, lbl, onLbl, suffix, hidden, onHide }) {
    return (
      <div className="rounded-xl p-3 space-y-2"
        style={{ background: hidden ? 'rgba(248,81,73,0.04)' : 'var(--bg)', border: `1.5px solid ${hidden ? 'rgba(248,81,73,0.2)' : 'var(--bd)'}`, opacity: hidden ? 0.6 : 1 }}>
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-bold" style={{ color: hidden ? '#f85149' : 'var(--tx)' }}>
            {label}{hidden && <span className="text-[9px] px-1.5 py-0.5 rounded ml-2" style={{ background: 'rgba(248,81,73,0.12)', color: '#f85149' }}>Hidden</span>}
          </span>
          <button onClick={() => onHide(!hidden)}
            className="text-[10px] px-2.5 py-1 rounded-lg font-semibold transition"
            style={hidden
              ? { color: '#3fb950', border: '1px solid rgba(63,185,80,0.3)', background: 'rgba(63,185,80,0.08)' }
              : { color: 'var(--tx2)', border: '1px solid var(--bd)', background: 'var(--bg2)' }}>
            {hidden ? '✓ Show' : '👁 Hide'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--tx2)' }}>Number</div>
            <div className="flex items-center gap-1">
              <input value={num} onChange={e => onNum(e.target.value)} type="number"
                className="flex-1 rounded-lg px-2.5 py-1.5 text-[13px] font-bold outline-none"
                style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', color: 'var(--accent)' }} />
              <span className="text-[11px] font-bold" style={{ color: 'var(--tx2)' }}>{suffix}</span>
            </div>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--tx2)' }}>Label</div>
            <input value={lbl} onChange={e => onLbl(e.target.value)}
              className="w-full rounded-lg px-2.5 py-1.5 text-[12px] outline-none"
              style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', color: 'var(--tx)' }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card title="📊 Hero Stats Bar — Animated counters below the banner">
      <div className="p-5 space-y-4">
        <div className="text-[11px] p-3 rounded-xl" style={{ background: 'rgba(88,166,255,0.06)', border: '1px solid rgba(88,166,255,0.18)', color: 'var(--tx2)' }}>
          💡 4 counters that animate up on page load. Edit the numbers, change label text, or hide any you don't need.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <StatRow label="Farmer Families" num={farmers} onNum={setFarmers} lbl={farmersLbl} onLbl={setFarmersLbl} suffix="+" hidden={hideFarmers} onHide={setHideFarmers} />
          <StatRow label="Himalayan States" num={states} onNum={setStates} lbl={statesLbl} onLbl={setStatesLbl} suffix="+" hidden={hideStates} onHide={setHideStates} />
          <StatRow label="Happy Customers" num={customers} onNum={setCustomers} lbl={customersLbl} onLbl={setCustomersLbl} suffix="k+" hidden={hideCustomers} onHide={setHideCustomers} />
          <StatRow label="Avg Dispatch" num={dispatch} onNum={setDispatch} lbl={dispatchLbl} onLbl={setDispatchLbl} suffix="hr" hidden={hideDispatch} onHide={setHideDispatch} />
        </div>
        <div className="flex justify-end"><SaveBtn onClick={save} saving={saving} saved={saved} label="Save Stats" /></div>
      </div>
    </Card>
  );
}

// ─── Section: Trust Bar ───────────────────────────────────────────────────────
const TRUST_DEFAULTS = [
  { icon: '🌿', title: '100% Natural',      sub: 'No chemicals, no preservatives'  },
  { icon: '🏔️', title: 'Himalayan Sourced', sub: 'Directly from mountain farms'    },
  { icon: '🤝', title: 'Fair Trade',         sub: 'Supporting local farmers always' },
  { icon: '🚚', title: 'Free Shipping',      sub: 'On orders above ₹799'            },
];
function TrustSection({ settings, onSaved }) {
  const s = settings || {};
  const [items, setItems] = useState(
    TRUST_DEFAULTS.map((d, i) => ({
      icon:   s[`trust_${i+1}_icon`]  || d.icon,
      title:  s[`trust_${i+1}_title`] || d.title,
      sub:    s[`trust_${i+1}_sub`]   || d.sub,
      hidden: s[`trust_${i+1}_hide`] === 'true',
    }))
  );
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  function update(i, field, val) { setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: val } : it)); }

  async function save() {
    setSaving(true); setSaved(false);
    try {
      await saveMany(items.flatMap((it, i) => [
        [`trust_${i+1}_icon`,  it.icon],
        [`trust_${i+1}_title`, it.title],
        [`trust_${i+1}_sub`,   it.sub],
        [`trust_${i+1}_hide`,  it.hidden ? 'true' : 'false'],
      ]));
      setSaved(true); setTimeout(() => setSaved(false), 3000); onSaved();
    } catch(e) { alert('Save failed: ' + e.message); }
    setSaving(false);
  }

  return (
    <Card title="✅ Trust Bar — Green strip with 4 badges below the hero">
      <div className="p-5 space-y-4">
        <div className="text-[11px] p-3 rounded-xl" style={{ background: 'rgba(88,166,255,0.06)', border: '1px solid rgba(88,166,255,0.18)', color: 'var(--tx2)' }}>
          💡 The 4 trust badges in the green bar below the hero. Edit text, change emoji icons, or hide individual badges.
        </div>
        <div className="grid grid-cols-2 gap-3">
          {items.map((it, i) => (
            <div key={i} className="rounded-xl p-3 space-y-2"
              style={{ background: it.hidden ? 'rgba(248,81,73,0.04)' : 'var(--bg)', border: `1.5px solid ${it.hidden ? 'rgba(248,81,73,0.2)' : 'var(--bd)'}`, opacity: it.hidden ? 0.6 : 1 }}>
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold" style={{ color: it.hidden ? '#f85149' : 'var(--tx)' }}>
                  Badge {i+1}{it.hidden && <span className="text-[9px] px-1.5 py-0.5 rounded ml-2" style={{ background: 'rgba(248,81,73,0.12)', color: '#f85149' }}>Hidden</span>}
                </span>
                <button onClick={() => update(i, 'hidden', !it.hidden)}
                  className="text-[10px] px-2.5 py-1 rounded-lg font-semibold transition"
                  style={it.hidden
                    ? { color: '#3fb950', border: '1px solid rgba(63,185,80,0.3)', background: 'rgba(63,185,80,0.08)' }
                    : { color: 'var(--tx2)', border: '1px solid var(--bd)', background: 'var(--bg2)' }}>
                  {it.hidden ? '✓ Show' : '👁 Hide'}
                </button>
              </div>
              <div className="grid grid-cols-[52px_1fr] gap-2 items-start">
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--tx2)' }}>Emoji</div>
                  <input value={it.icon} onChange={e => update(i, 'icon', e.target.value)}
                    className="w-full rounded-lg px-1 py-1.5 text-[18px] text-center outline-none"
                    style={{ background: 'var(--bg2)', border: '1px solid var(--bd)' }} maxLength={4} />
                </div>
                <div className="space-y-2">
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--tx2)' }}>Title</div>
                    <input value={it.title} onChange={e => update(i, 'title', e.target.value)}
                      className="w-full rounded-lg px-2 py-1.5 text-[12px] font-bold outline-none"
                      style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', color: 'var(--tx)' }} />
                  </div>
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--tx2)' }}>Subtitle</div>
                    <input value={it.sub} onChange={e => update(i, 'sub', e.target.value)}
                      className="w-full rounded-lg px-2 py-1.5 text-[11px] outline-none"
                      style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', color: 'var(--tx2)' }} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end"><SaveBtn onClick={save} saving={saving} saved={saved} label="Save Trust Bar" /></div>
      </div>
    </Card>
  );
}

const TABS = [
  { key: 'shipping', label: '🚚 Shipping'     },
  { key: 'contact',  label: '📞 Contact'       },
  { key: 'social',   label: '🔗 Social'        },
  { key: 'seo',      label: '🔍 SEO'           },
  { key: 'orders',   label: '🛒 Orders'        },
  { key: 'store',    label: '🏪 Status'        },
  { key: 'email',    label: '📧 Email'         },
  { key: 'stats',    label: '📊 Stats Bar'     },
  { key: 'trust',    label: '✅ Trust Bar'     },
  { key: 'ann',      label: '📢 Ann Bar'       },
  { key: 'ticker',   label: '🎢 Ticker'        },
];

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState('shipping');

  const load = useCallback(async () => {
    setLoading(true);
    try { setSettings(await loadAllSettings()); }
    catch { setSettings({}); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loader text="Loading settings…" />;

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-[20px] font-bold" style={{ color: 'var(--tx)' }}>⚙️ Settings</h1>
        <p className="text-[12px] mt-1" style={{ color: 'var(--tx2)' }}>
          Configure shipping, contact info, sale banners, SEO, payments and more. Changes go live instantly.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 p-1 rounded-xl" style={{ background: 'var(--bg2)', border: '1px solid var(--bd)' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="py-1.5 px-3 rounded-lg text-[11.5px] font-semibold transition"
            style={tab === t.key
              ? { background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)' }
              : { color: 'var(--tx2)' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Sections */}
      {tab === 'shipping' && <ShippingSection    settings={settings} onSaved={load} />}
      {tab === 'contact'  && <ContactSection     settings={settings} onSaved={load} />}
      {tab === 'social'   && <SocialSection      settings={settings} onSaved={load} />}
      {tab === 'seo'      && <SeoSection         settings={settings} onSaved={load} />}
      {tab === 'orders'   && <OrderSection       settings={settings} onSaved={load} />}
      {tab === 'store'    && <StoreStatusSection settings={settings} onSaved={load} />}
      {tab === 'email'    && <EmailSection       settings={settings} onSaved={load} />}
      {tab === 'stats'    && <StatsSection       settings={settings} onSaved={load} />}
      {tab === 'trust'    && <TrustSection       settings={settings} onSaved={load} />}
      {tab === 'ann'      && <AnnBarSection      settings={settings} onSaved={load} />}
      {tab === 'ticker'   && <TickerSection      settings={settings} onSaved={load} />}

      {/* Raw inspector always visible at bottom */}
      <RawSettingsViewer settings={settings} />
    </div>
  );
}
