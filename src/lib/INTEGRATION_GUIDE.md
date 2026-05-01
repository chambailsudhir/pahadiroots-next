# How to wire "Save as Product →" into your existing Products page

## What was built

`src/lib/pricingPrefill.js` — a zero-coupling bridge.  
The Pricing Engine writes a payload to `sessionStorage` and navigates to  
`/admin/products?addNew=1&fromPricing=1`.  
Your Products page reads the payload and fires its **own existing** Add Product modal.

---

## 3-line integration in your Products page

### Step 1 — import the hook (top of your products page file)

```js
import { usePricingPrefill } from '@/lib/pricingPrefill';
```

### Step 2 — call the hook inside your component

```js
// Inside your Products page component, near the top:
const pricingPrefill = usePricingPrefill();
```

### Step 3 — auto-open modal + pass prefill when arriving from Pricing Engine

```js
// In a useEffect that runs once on mount:
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('fromPricing') === '1' && params.get('addNew') === '1') {
    openAddProductModal();   // ← call whatever function/setState opens your modal
  }
}, []);
```

### Step 4 — pass prefill into your Add Product modal

```jsx
<AddProductModal
  prefill={pricingPrefill}   // ← add this prop
  {...everythingElseYouAlreadyPass}
/>
```

### Step 5 — read prefill in AddProductModal

In your existing `AddProductModal` component, wherever you initialize state:

```js
// Before:
const [price, setPrice] = useState('');
const [mrp, setMrp]     = useState('');
const [costPrice, setCostPrice] = useState('');
const [gstRate, setGstRate]     = useState(5);

// After:
const [price, setPrice]         = useState(prefill?.price      ?? '');
const [mrp, setMrp]             = useState(prefill?.mrp        ?? '');
const [costPrice, setCostPrice] = useState(prefill?.cost_price ?? '');
const [gstRate, setGstRate]     = useState(prefill?.gst_rate   ?? 5);
// mrp_display is the customer-facing MRP strikethrough price:
const [mrpDisplay, setMrpDisplay] = useState(prefill?.mrp_display ?? '');
```

### Step 6 — show the green pricing banner inside your modal (optional but recommended)

```jsx
{prefill && (
  <div style={{
    padding: '12px 20px',
    background: 'rgba(63,185,80,0.07)',
    borderBottom: '1px solid rgba(63,185,80,0.2)',
    display: 'flex', flexWrap: 'wrap', gap: 16,
  }}>
    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.05em', color: '#8b949e', width: '100%' }}>
      ✓ Pricing pre-filled from calculator — just add name, category & state
    </div>
    {[
      { label: 'Base price (excl GST)',    val: `₹${prefill.price}` },
      { label: 'Selling price (incl GST)', val: `₹${prefill.mrp}`,         accent: true },
      { label: 'MRP (strikethrough)',       val: `₹${prefill.mrp_display}` },
      { label: 'Cost price',               val: `₹${prefill.cost_price}` },
      { label: 'GST rate',                 val: `${prefill.gst_rate}%` },
      { label: 'Gross margin',             val: `${prefill._margin_pct}%` },
    ].map((item, i) => (
      <div key={i}>
        <div style={{ fontSize: 10, color: '#8b949e' }}>{item.label}</div>
        <div style={{ fontSize: 14, fontWeight: 700,
          color: item.accent ? '#3fb950' : '#e6edf3' }}>{item.val}</div>
      </div>
    ))}
  </div>
)}
```

---

## Prefill payload shape

```ts
{
  price:        number   // base price excl GST  → your DB `price` column
  mrp:          number   // selling price incl GST → your DB `mrp` column (selling price)
  mrp_display:  number   // MRP strikethrough shown to customer
  cost_price:   number   // purchase cost from Stage 1
  gst_rate:     number   // output GST %
  _margin_pct:  number   // for display only in banner
  _profit_val:  number   // for display only in banner
  _source:      'pricing_engine'
}
```

---

## Why this approach

- **Zero coupling** — the Pricing Engine has no import from your Products page.  
  They communicate only via sessionStorage + URL params.
- **Your existing modal unchanged** — all tabs (Basic Info, Pricing & Variants, AI Content)  
  work exactly as before. The prefill just sets initial values.
- **Safe** — payload is cleared from sessionStorage immediately on first read,  
  so a refresh doesn't re-trigger the modal.
- **Graceful** — if the user navigates directly to `/admin/products` without `?fromPricing=1`,  
  `usePricingPrefill()` returns `null` and everything works normally.
