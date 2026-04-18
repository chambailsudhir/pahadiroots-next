// ─── ADD THIS COMPONENT TO pahadi-admin/src/app/admin/settings/page.jsx ─────
// Replace the "Future-ready toggles / COMING SOON" block in StoreStatusSection
// with a call to <SiteVisibilitySection settings={settings} onSaved={reload} />
// Also add the component itself before the tabs nav section.
//
// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: Find this line in StoreStatusSection and delete the block below it:
//   {/* Future-ready toggles */}
//   <div className="py-3" style={{ borderBottom: '1px solid var(--bd)' }}>
//     ...entire COMING SOON block...
//   </div>
//
// STEP 2: Add <SiteVisibilitySection settings={settings} onSaved={onSaved} />
//   right after StoreStatusSection in the main page render.
//
// STEP 3: Paste this component code into the file.
// ─────────────────────────────────────────────────────────────────────────────

function SiteVisibilitySection({ settings, onSaved }) {
  const TOGGLES = [
    // Homepage sections
    { key: 'show_trust_bar',        label: '🛡️ Trust Bar',            desc: 'Natural / Free Shipping / COD / Secure strip below hero' },
    { key: 'show_best_sellers',     label: '🔥 Best Sellers Section',  desc: 'Best sellers carousel on homepage' },
    { key: 'show_new_arrivals',     label: '🌱 New Arrivals Section',  desc: 'Newest products section on homepage' },
    { key: 'show_state_stories',    label: '🏔️ Shop by Region',       desc: 'State/region cards section on homepage' },
    { key: 'show_reviews_section',  label: '⭐ Reviews Section',       desc: 'Customer reviews section on homepage' },
    { key: 'show_newsletter_bar',   label: '📧 Newsletter Signup',     desc: 'Email subscription bar on homepage' },
    { key: 'show_blog_section',     label: '✍️ Blog Preview',         desc: 'Blog posts preview section on homepage' },
    // Product pages
    { key: 'show_reviews_on_pdp',   label: '⭐ Reviews on PDP',       desc: 'Customer reviews on product detail page' },
    { key: 'show_related_products', label: '🔗 Related Products',     desc: '"You might also like" carousel on PDP' },
    // Features
    { key: 'show_wishlist',         label: '❤️ Wishlist Feature',     desc: 'Heart icon on product cards, wishlist page' },
    { key: 'show_track_order_page', label: '📦 Public Order Tracker', desc: '/track page — customers check order status without login' },
    { key: 'show_blog',             label: '📝 Blog Section',         desc: 'Blog in navigation + /blog page' },
    { key: 'catalogue_visible',     label: '🛒 Product Catalogue',    desc: 'Show all products publicly. Turn OFF to show "coming soon"' },
    // Checkout
    { key: 'cod_enabled',           label: '💵 COD Payments',         desc: 'Enable Cash on Delivery at checkout' },
  ];

  const NUM_FIELDS = [
    { key: 'prepaid_discount_pct', label: 'Prepaid Discount %',   hint: 'Extra % off for online payment. Set 0 to disable.', suffix: '%', type: 'number', min: 0, max: 30 },
    { key: 'cod_max_value',        label: 'COD Max Order Value',  hint: 'COD disabled above this amount. Set 0 for no limit.', prefix: '₹', type: 'number' },
    { key: 'featured_collection_slug', label: 'Featured Collection Slug', hint: 'Homepage featured banner — enter collection slug (e.g. honey)', type: 'text', placeholder: 'honey' },
  ];

  // Build initial state from all toggle keys
  const initState = {};
  TOGGLES.forEach(t => { initState[t.key] = settings[t.key] ?? 'true'; });
  NUM_FIELDS.forEach(f => { initState[f.key] = settings[f.key] ?? ''; });

  const [vals, setVals] = React.useState(initState);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved]   = React.useState(false);

  React.useEffect(() => {
    const s = {};
    TOGGLES.forEach(t => { s[t.key] = settings[t.key] ?? 'true'; });
    NUM_FIELDS.forEach(f => { s[f.key] = settings[f.key] ?? ''; });
    setVals(s);
  }, [settings]);

  function set(key, val) { setVals(v => ({ ...v, [key]: val })); }

  async function save() {
    setSaving(true); setSaved(false);
    try {
      const pairs = Object.entries(vals);
      await saveMany(pairs);
      setSaved(true); setTimeout(() => setSaved(false), 3000); onSaved?.();
    } catch (e) { alert('Save failed: ' + e.message); }
    setSaving(false);
  }

  return (
    <Card title="🎛️ Site Sections — Control what's visible on the live site">
      <div className="space-y-0">

        {/* Info */}
        <div className="mb-3 px-3 py-3 rounded-lg text-[11px]" style={{ background: 'rgba(88,166,255,0.07)', border: '1px solid rgba(88,166,255,0.18)', color: 'var(--tx2)' }}>
          ℹ️ All changes reflect on the live site within 5 minutes. No redeployment needed.
        </div>

        {/* Section toggles */}
        <div className="space-y-2 py-3" style={{ borderBottom: '1px solid var(--bd)' }}>
          {TOGGLES.map(t => (
            <FieldRow key={t.key} label={t.label} hint={t.desc}>
              <Toggle
                value={vals[t.key]}
                onChange={v => set(t.key, v)}
                label={vals[t.key] === 'true' ? '✅ Visible' : '🚫 Hidden'}
              />
            </FieldRow>
          ))}
        </div>

        {/* Numeric + text fields */}
        <div className="space-y-0 py-3">
          {NUM_FIELDS.map(f => (
            <FieldRow key={f.key} label={f.label} hint={f.hint}>
              <Input
                value={vals[f.key] || ''}
                onChange={v => set(f.key, v)}
                type={f.type || 'text'}
                prefix={f.prefix}
                suffix={f.suffix}
                placeholder={f.placeholder || ''}
              />
            </FieldRow>
          ))}
        </div>

        <div className="pt-4">
          <SaveBtn onClick={save} saving={saving} saved={saved} label="Save Visibility Settings" />
        </div>
      </div>
    </Card>
  );
}
