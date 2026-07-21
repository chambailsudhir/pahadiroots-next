'use client';
// ── ProductsTab ───────────────────────────────────────────────────────────────
// All business logic is identical to the original monolith.
// Changes made in this refactor:
//   1. TypeScript types via _types/index.ts
//   2. Modal → AccessibleModal (focus trap + ARIA dialog role + Escape key)
//   3. All interactive elements have aria-label / aria-describedby
//   4. CGST/SGST rounding fix: Math.floor(gst_p/2) so CGST + SGST = GST exactly
//   5. Upload helpers moved to _lib/upload.ts
//   6. GST HSN rules hook via _hooks/useGstHsnRules.ts
import React, {
  useState, useEffect, useCallback, useRef, useMemo,
} from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { api } from '@/lib/api';
import { Card, Loader, ErrorMsg, Badge } from '@/components/ui/index';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import AccessibleModal from '../ui/AccessibleModal';
import Field from '../ui/Field';
import { CharCounter } from '../ui/CharCounter';
import { inp, MIN_MARGIN_WARN_PCT, PRODUCTS_PAGE_SIZE, VERSION_HISTORY_LIMIT, slugify, SEO_TITLE_MAX, SEO_DESC_MAX } from '../../_lib/constants';
import { useGstHsnRules } from '../../_hooks/useGstHsnRules';
import { useCatalogueAI } from '@/hooks/useCatalogueAI';
import { useToast, ToastDisplay, useConfirm, ConfirmDisplay } from '@/components/ui/Toast';
import { compressAndUpload, uploadVideo } from '../../_lib/upload';
// ARCH FIX: Wire in the extracted hooks instead of duplicating state inline.
// useProductForm, useVariants, useVersionHistory, useProductUploads were created
// during the refactor but never imported here — the monolith state block remained.
import { useProductUploads, useVersionHistory } from '@/hooks/catalogue';
import { useCatalogueData } from '@/hooks/useCatalogueData';
import { useProductForm } from '@/hooks/useProductForm';
import { useVariants } from '@/hooks/useVariants';
import {
  toPaise, toRupees, addGst, removeGst,
  parseInputFloat, calcVariantPrices, generateSku,
  psychologicalRound, smartPriceOptions,
  marginHealth, MARGIN_THRESHOLDS, MARGIN_LABELS,
  validateField, DEFAULT_F, GST_RATES,
} from '@/lib/pricingCalc';
import type {
  Product, ProductForm, VariantRow, VariantRowDB, AiContent,
  ProductVersion, ProductImage, Category, State, Vendor, AttrDef,
  PrefillPricing,
} from '../../_types';
import { EMPTY_PRODUCT_FORM, castArray, castItem, castMaybe, normalizeVariantRow } from '../../_types';

// ── FIX (CRITICAL): Input sanitization — stored XSS via product fields ────────
// Product name, description, and tags are rendered on the customer storefront.
// Strip all HTML tags server-side is the right answer, but we also strip them
// client-side as the first line of defence. This covers the common injection
// vector: <script>stealCookies()</script> in a product name.
function sanitizeText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    // Strip null bytes — can be used to bypass downstream parsers
    .replace(/\0/g, '')
    // Strip all HTML/XML tags (including multi-line via [\s\S] inside the tag)
    .replace(/<[^>]*>/g, '')
    // Strip javascript: and data: URIs that could survive tag stripping
    // (e.g. a bare href value that was never inside a tag)
    .replace(/\b(?:javascript|data|vbscript):/gi, '')
    .trim();
}

// Re-export the constant so it's easier to reference
const EMPTY_FORM = EMPTY_PRODUCT_FORM;

// SECURITY FIX (MEDIUM): Validate image URLs before rendering <img src={...}>.
// A javascript: or data: URI in image_url can bypass some CSP configurations and
// trigger SSRF-via-browser or content injection depending on proxy/CDN setup.
// Only allow https: URLs from trusted hosts, or relative /uploads paths.
const ALLOWED_MEDIA_HOSTS = ['pahadiroots.com', 'supabase.co'];

// TYPE FIX (build-breaking — found while fixing Error Handling & UX bugs):
// isSafeImageUrl/isSafeVideoUrl returned a plain `boolean`, so
// `{isSafeImageUrl(p.image_url) && <img src={p.image_url} .../>}` did NOT narrow
// `p.image_url` (typed `string | null`) for the `src` prop, which only accepts
// `string | undefined`. This failed `tsc --noEmit --strict` (TS2322) and blocked
// the build entirely — the most severe form of "error handling" failure, since no
// error-handling code can ship if the app doesn't compile. Declaring these as type
// predicates (`url is string`) lets TypeScript narrow correctly at every call site.
function isSafeImageUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url.trim()) return false;
  if (url.startsWith('/')) return true;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_MEDIA_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch { return false; }
}

// SECURITY FIX: Same allow-list for video URLs — prevents javascript:/data: URIs
// being loaded into a <video> src, which can trigger navigation or content injection.
function isSafeVideoUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url.trim()) return false;
  if (url.startsWith('/')) return true;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_MEDIA_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch { return false; }
}

// ── DurationInput (self-contained sub-component) ──────────────────────────────
// NEW: supports the 'duration' product-attribute data_type (e.g. Shelf Life) —
// a compound value of a number + a unit (Days/Months/Years), stored as a single
// text string like "90 Days" in product_attribute_values.value (that table's
// value column is plain text; no schema change to it was needed or made).
// parseDuration is defensive: it accepts the plain-number legacy values that
// existed before this feature (e.g. "90" with no unit) and defaults them to
// Days, and falls back gracefully on any unrecognised format rather than
// throwing, so an admin editing a product never sees a crash if the value
// was set programmatically or from an older UI.
function parseDuration(val: string): { num: string; unit: 'Days' | 'Months' | 'Years' } {
  if (!val) return { num: '', unit: 'Days' };
  const m = val.trim().match(/^(\d+(?:\.\d+)?)\s*(days?|months?|years?)?$/i);
  if (!m) return { num: val.trim(), unit: 'Days' }; // unrecognised shape — don't crash, just show it
  const num = m[1];
  let unit: 'Days' | 'Months' | 'Years' = 'Days';
  if (m[2]) {
    const u = m[2].toLowerCase();
    if (u.startsWith('month')) unit = 'Months';
    else if (u.startsWith('year')) unit = 'Years';
  }
  return { num, unit };
}

function DurationInput({ id, value, onChange, inputClassName }: {
  id: string; value: string; onChange: (v: string) => void; inputClassName: string;
}) {
  const parsed = parseDuration(value);
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input
        id={id}
        type="number"
        min="0"
        value={parsed.num}
        onChange={e => onChange(e.target.value ? `${e.target.value} ${parsed.unit}` : '')}
        className={inputClassName}
        style={{ flex: 1, minWidth: 0 }}
        placeholder="e.g. 90"
      />
      <select
        value={parsed.unit}
        onChange={e => onChange(parsed.num ? `${parsed.num} ${e.target.value}` : '')}
        className={inputClassName}
        style={{ width: 100, flexShrink: 0 }}
        aria-label="Shelf life unit"
      >
        <option value="Days">Days</option>
        <option value="Months">Months</option>
        <option value="Years">Years</option>
      </select>
    </div>
  );
}

// ── HsnSelector (self-contained sub-component) ───────────────────────────────
// LOW-MED FIX: The previous implementation loaded ALL 200 active HSN codes
// eagerly on first focus and filtered client-side.  This breaks silently when
// the HSN table grows beyond 200 rows (legitimate codes are excluded) and
// causes an unnecessary 200-row fetch on every ProductsTab open.
//
// New behaviour:
//   • On focus with no/short query  → fetch top 50 by hsn_code (fast, deterministic)
//   • On query ≥ 2 chars            → debounced server-side ilike search (no cap)
//   • Results are never stale: each search is a fresh fetch, not a client-side filter
//   • Selected value is always resolvable: if value is set but not in the result set,
//     we fetch it explicitly so the "✓ description" row still renders.
// ─────────────────────────────────────────────────────────────────────────────
function HsnSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [hsnList,   setHsnList]   = useState<{ hsn_code: string; description: string; cgst_rate: number; sgst_rate: number }[]>([]);
  const [hsnError,  setHsnError]  = useState(false);
  // FIX (Issue 2 — misleading error message): previously a genuine zero-match
  // search result set the SAME hsnError flag as an actual network/DB failure,
  // showing "Could not load HSN codes — click to retry" even when the request
  // succeeded perfectly and simply found nothing. Retrying a successful search
  // with no matches can never help — the message was actively misleading.
  // hsnNoResults is now tracked separately so the UI can tell the admin the
  // true situation: "no HSN code matches your search" vs "the request failed".
  const [hsnNoResults, setHsnNoResults] = useState(false);
  const [hsnLoading, setHsnLoading] = useState(false);
  const [search,    setSearch]    = useState(value || '');
  const [open,      setOpen]      = useState(false);
  // selectedItem is kept separately so the "✓ description" confirmation row always
  // renders even when the search results don't include the currently-selected code.
  const [selectedItem, setSelectedItem] = useState<{ hsn_code: string; description: string; cgst_rate: number; sgst_rate: number } | null>(null);
  const debouncedSearch = useDebounce(search, 350);
  // ACCESSIBILITY FIX (MEDIUM): Track keyboard-focused listbox item for aria-activedescendant.
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const listboxRef = useRef<HTMLDivElement>(null);
  const abortRef   = useRef<AbortController | null>(null);

  // Fetch HSN codes from the server — either top-50 browse or full-text search.
  // Each call cancels any in-flight request via AbortController.
  const fetchHsn = useCallback(async (query: string) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setHsnError(false);
    setHsnNoResults(false);
    setHsnLoading(true);
    try {
      let qs: string;
      if (query.length >= 2) {
        // Server-side ilike search — no row cap, covers any HSN table size.
        // Supabase PostgREST: or=(col.ilike.*q*,...) for OR across columns.
        const enc = encodeURIComponent(`*${query}*`);
        qs = `select=hsn_code,description,cgst_rate,sgst_rate&is_active=eq.true` +
             `&or=(hsn_code.ilike.${enc},description.ilike.${enc})` +
             `&order=hsn_code.asc&limit=30`;
      } else {
        // Browse mode: top 50 by code, no filter.
        qs = `select=hsn_code,description,cgst_rate,sgst_rate&is_active=eq.true&order=hsn_code.asc&limit=50`;
      }
      const rows = castArray<typeof hsnList[number]>(await api.get('hsn_codes', qs), 'hsn_codes');
      setHsnList(rows?.length > 0 ? rows : []);
      // A successful request that simply found nothing is NOT the same as a
      // failed request — do not set hsnError here (see hsnNoResults above).
      if (!rows?.length && query.length >= 2) setHsnNoResults(true);
    } catch (err: unknown) {
      // Ignore AbortError — it's an intentional cancel, not a real error.
      if (err instanceof Error && err.name !== 'AbortError') setHsnError(true);
    } finally {
      setHsnLoading(false);
    }
  }, []);

  // Resolve the selected value's full row so the confirmation row always renders.
  // Only fires when `value` changes and the selected item isn't already in hsnList.
  //
  // BUG-22 FIX: This effect depends on [value, hsnList]. hsnList gets a new array
  // reference every ~350ms while the admin types in the HSN search box (fetchHsn
  // re-runs on every debounced keystroke). Previously, every one of those hsnList
  // updates re-ran this effect — and if `value` (the product's saved HSN code)
  // wasn't in the new search results (the common case, since search results are
  // for a *different* query than the saved value), it re-fetched the exact same
  // single-row `hsn_codes?hsn_code=eq.${value}` query over and over, once per
  // keystroke, for data that never changes.
  // Fix: skip the fetch if selectedItem already matches the current `value` —
  // we've already resolved it and don't need to ask the server again.
  useEffect(() => {
    if (!value) { setSelectedItem(null); return; }
    const found = hsnList.find(h => h.hsn_code === value);
    if (found) { setSelectedItem(found); return; }
    if (selectedItem?.hsn_code === value) return; // already resolved — skip re-fetch
    // Not in current results — fetch it directly.
    api.get('hsn_codes',
      `select=hsn_code,description,cgst_rate,sgst_rate&hsn_code=eq.${encodeURIComponent(value)}&limit=1`
    ).then((rows: unknown) => {
      const r = castArray<typeof hsnList[number]>(rows, 'hsn_codes');
      if (r[0]) setSelectedItem(r[0]);
    }).catch(() => {});
  }, [value, hsnList, selectedItem]);

  // Re-fetch whenever the debounced query changes or the dropdown opens.
  // BUG-03 FIX: Return a cleanup function that aborts any in-flight fetch when
  // the component unmounts or before the next effect run. Without this, a slow
  // network response that arrives after unmount calls setHsnList/setHsnLoading
  // on a dead component, producing a React "setState on unmounted component" warning
  // and — in strict mode — a potential stale-closure bug.
  useEffect(() => {
    if (open) fetchHsn(debouncedSearch);
    return () => { abortRef.current?.abort(); };
  }, [debouncedSearch, open, fetchHsn]);

  // Reset active index when the result list changes.
  useEffect(() => { setActiveIdx(-1); }, [hsnList]);

  function selectItem(h: typeof hsnList[number]) {
    onChange(h.hsn_code);
    setSearch(h.hsn_code);
    setSelectedItem(h);
    setOpen(false);
    setActiveIdx(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown') { setOpen(true); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(activeIdx + 1, hsnList.length - 1);
      setActiveIdx(next);
      listboxRef.current?.querySelector<HTMLElement>(`[id="hsn-opt-${next}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(activeIdx - 1, 0);
      setActiveIdx(prev);
      listboxRef.current?.querySelector<HTMLElement>(`[id="hsn-opt-${prev}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && hsnList[activeIdx]) selectItem(hsnList[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIdx(-1);
    }
  }

  const activeDescendant = activeIdx >= 0 ? `hsn-opt-${activeIdx}` : undefined;

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input value={search}
          id="hsn-input"
          role="combobox"
          aria-label="HSN code search"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-busy={hsnLoading}
          aria-controls={open ? 'hsn-listbox' : undefined}
          aria-activedescendant={open ? activeDescendant : undefined}
          onChange={e => { setSearch(e.target.value); setOpen(true); setActiveIdx(-1); if (value) onChange(''); }}
          onFocus={() => { setOpen(true); }}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Type HSN code or description…"
          className={inp}
          style={{ flex: 1, fontFamily: 'monospace' }} />
        {hsnLoading && <span aria-hidden="true" style={{ fontSize: 11, color: 'var(--tx2)' }}>…</span>}
        {value && (
          <button onClick={() => { onChange(''); setSearch(''); setSelectedItem(null); }}
            aria-label="Clear HSN code selection"
            style={{ background: 'none', border: 'none', color: '#f85149', cursor: 'pointer', fontSize: 16 }}>×</button>
        )}
      </div>
      {value && selectedItem && (
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--tx2)' }}>
          ✓ {selectedItem.description} · GST {selectedItem.cgst_rate + selectedItem.sgst_rate}%
        </div>
      )}
      {open && hsnError && (
        <div role="alert"
          style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: 'var(--bg2,#161b22)', border: '1px solid #f85149', borderRadius: 8, padding: '10px 12px', marginTop: 2, fontSize: 11, color: '#f85149' }}>
          ⚠ Could not load HSN codes — click the field to retry, or type the code manually.
        </div>
      )}
      {/* FIX (Issue 2): zero search matches is a successful request, not a
          failure — this is a separate, non-alarming message that does not
          suggest "retry" (retrying the same search on the same data can
          never produce a different result). It tells the admin the actual
          situation and that manual entry is available. */}
      {open && !hsnError && hsnNoResults && (
        <div role="status"
          style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: 'var(--bg2,#161b22)', border: '1px solid var(--bd)', borderRadius: 8, padding: '10px 12px', marginTop: 2, fontSize: 11, color: 'var(--tx2)' }}>
          No HSN code found matching "{search}". You can type the code manually if you know it, or ask an admin to add it to the HSN list.
        </div>
      )}
      {open && !hsnError && hsnList.length > 0 && (
        <div id="hsn-listbox" role="listbox" aria-label="HSN code options" ref={listboxRef}
          // FIX (Issue 2 — RESTORED during line-by-line re-audit): without this
          // handler, mousedown on the scrollbar track or any non-button area
          // inside this div causes the <input> to lose focus. The input's
          // onBlur fires → setTimeout(setOpen(false), 150) → dropdown closes
          // before the user can scroll. This exact fix was applied earlier in
          // this session but was found MISSING during the full line-by-line
          // re-check — very likely lost when a later edit to this same file
          // (product-attribute dropdown additions) replaced a nearby block
          // without preserving it. The individual option <button>s below
          // already had their own onMouseDown (line ~369, pre-existing,
          // unrelated to this fix) — that only covers clicking an option, not
          // the empty/scrollbar area of the container itself.
          onMouseDown={e => e.preventDefault()}
          style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: 'var(--bg2,#161b22)', border: '1px solid var(--bd)', borderRadius: 8, maxHeight: 220, overflowY: 'auto', marginTop: 2, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
          {hsnList.map((h, idx) => (
            <button key={h.hsn_code} id={`hsn-opt-${idx}`} role="option"
              // A11Y-3 FIX: role="option" buttons inside an aria-activedescendant
              // combobox must NOT be in the Tab sequence — the input retains real
              // DOM focus while aria-activedescendant points at the "virtually
              // focused" option. Without tabIndex={-1}, pressing Tab while the
              // listbox is open moved focus off the input and into these <button>
              // elements one at a time (their native default), breaking both the
              // ARIA pattern and the onBlur-close-on-150ms-timeout logic below.
              tabIndex={-1}
              aria-selected={value === h.hsn_code}
              aria-label={`HSN ${h.hsn_code} — ${h.description} — GST ${h.cgst_rate + h.sgst_rate}%`}
              title={`${h.hsn_code}: ${h.description} (GST ${h.cgst_rate + h.sgst_rate}%)`}
              onMouseDown={e => { e.preventDefault(); selectItem(h); }}
              style={{
                display: 'flex', justifyContent: 'space-between', width: '100%', padding: '8px 12px',
                background: idx === activeIdx ? 'rgba(88,166,255,0.12)' : 'none',
                border: 'none', borderBottom: '1px solid var(--bd)',
                cursor: 'pointer', textAlign: 'left',
                outline: idx === activeIdx ? '2px solid #58a6ff' : 'none',
                outlineOffset: -2,
              }}>
              <span style={{ fontFamily: 'monospace', color: 'var(--blue)', fontWeight: 700, fontSize: 12 }}>{h.hsn_code}</span>
              <span style={{ fontSize: 11, color: 'var(--tx2)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.description}</span>
              <span style={{ fontSize: 11, color: '#3fb950', fontWeight: 700, flexShrink: 0 }}>{h.cgst_rate + h.sgst_rate}%</span>
            </button>
          ))}
        </div>
      )}
      {open && <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setOpen(false)} aria-hidden="true" />}
    </div>
  );
}

// ── ProductsTab ───────────────────────────────────────────────────────────────
interface ProductsTabProps {
  prefillPricing?: PrefillPricing | null;
  // FIX (Operations audit follow-up, July 2026): the "Edit Stock →" link on
  // the Operations page's Low Stock table used to send admins to
  // /admin/products — an orphaned, sidebar-less analytics-only page with no
  // edit capability at all. It now deep-links here (the sidebar's real
  // "Products" destination) with the product name pre-filled into search,
  // via CataloguePage reading ?q= — see the effect below.
  initialSearch?: string;
}

export default function ProductsTab({ prefillPricing = null, initialSearch = '' }: ProductsTabProps) {
  // ── In-page notifications ─────────────────────────────────────────────────
  const { toast, showToast }                         = useToast();
  const { confirmState, showConfirm, handleResolve } = useConfirm();

  // ── ARCH FIX: Data-loading domain — useCatalogueData hook ─────────────────
  // Previously: 16 useState declarations + the load()/bulkStatusChange()
  // functions + 2 useEffects, all inline here (the "Step 1" extraction
  // MIGRATION_GUIDE.md planned but whose hook file was never actually created).
  // Now: owned by the hook; onConfirm/onToast injected so the hook has no
  // dependency on the Toast/Confirm UI components.
  const {
    products, setProducts, categories, states, vendors, attrDefs, variantStockMap,
    gstRates, loading, error,
    search, setSearch, debouncedSearch, filterCat, setFilterCat,
    page, setPage, totalCount, PAGE_SIZE,
    selected, setSelected, bulkLoading, setBulkLoading, showArchived, setShowArchived,
    load, bulkStatusChange,
  } = useCatalogueData({ onConfirm: showConfirm, onToast: showToast });

  // Deep-link prefill: seed the search box once if we arrived here with
  // ?q= set (see initialSearch prop comment above).
  useEffect(() => { if (initialSearch) setSearch(initialSearch); }, [initialSearch, setSearch]);

  // ── Page-level state that stays here (belongs to this component, not the
  // shared data-loading domain) ─────────────────────────────────────────────
  const [modal, setModal]             = useState<null | 'add' | Product>(null);
  const [saving, setSaving]           = useState(false);
  const [filterSize, setFilterSize]   = useState('');
  const [filterStock, setFilterStock] = useState('');
  const [modalTab, setModalTab]       = useState<'basic' | 'pricing' | 'ai'>('basic');
  const [attrValues, setAttrValues]   = useState<Record<number, string>>({});

  // ── Adjust Stock (existing variants only) ────────────────────────────────
  // Separate from the batched `variants` form state on purpose: this applies
  // immediately via adjust_variant_stock (its own transaction, its own audit
  // row in stock_movements/inventory_ledger) rather than waiting for
  // "Save Product". Keeping it out of the variants[] state avoids it being
  // re-sent (or double-applied) by the normal save flow.
  const [stockAdjustDelta, setStockAdjustDelta]   = useState<Record<number, string>>({});
  const [stockAdjustReason, setStockAdjustReason] = useState<Record<number, string>>({});
  const [stockAdjustBusy, setStockAdjustBusy]     = useState<number | null>(null);


  // ── ARCH FIX: Product form state — useProductForm hook ───────────────────
  // Previously: 1 useState<ProductForm> + mrpError useState inline here.
  // Now: owned by the hook, which also fixes the CRITICAL setForm shim bug
  // where updater({}) wiped all existing form state on functional updates.
  const { form, setForm, mrpError, setMrpError } = useProductForm();

  // Tracks whether the admin has actively touched the variants list (add/edit/remove)
  // during the *current* modal session. Used to distinguish "we just loaded existing
  // variants and synced the form for display" (silent — no toast, expected) from
  // "the admin edited a variant price and it changed the product-level selling price"
  // (should be visible — see onPricingSync below). Reset on every modal open.
  const hasUserEditedVariantsRef = useRef(false);

  // ── ARCH FIX: Variant state — useVariants hook ───────────────────────────
  // Previously: 12 useState declarations (variants, autoPanel, avBasePrice,
  // avBaseUnit, avUnitType, variantStrategy, avSelectedSizes, WEIGHT_SIZES,
  // LIQUID_SIZES, ALL_SIZES, + 3 functions) all inline in this component.
  // Now: owned by the hook; injectable onAlert/onConfirm replace alert()/confirm().
  const catMap = useMemo(
    () => Object.fromEntries(categories.map(c => [String(c.id), c.name])),
    [categories],
  );
  const {
    variants, setVariants,
    // NOTE: variantStockMap is NOT from useVariants — it is local to ProductsTab (see below).
    // The hook no longer exports it (was dead state — see useVariants.ts for details).
    autoPanel, setAutoPanel,
    avBasePrice, setAvBasePrice,
    avBaseUnit, setAvBaseUnit,
    avUnitType, setAvUnitType,
    variantStrategy, setVariantStrategy,
    avSelectedSizes, setAvSelectedSizes,
    allSizes: ALL_SIZES,
    addVariant: addVariantRaw, removeVariant: removeVariantRaw, updateVariant: updateVariantRaw,
    autoGenerate: autoGenerateVariantsRaw,
    syncPricingFromVariants,
  } = useVariants({
    form,
    catMap,
    // BUSINESS LOGIC FIX (Audit — Business Logic Correctness, WARN):
    // syncPricingFromVariants previously overwrote form.selling_price with the lowest
    // active variant price completely silently. If an admin had manually typed a
    // product-level selling_price (e.g. before adding/editing variants), that value
    // would vanish the moment any variant price changed — with zero indication that
    // anything happened. The admin would only discover it later, looking at the wrong
    // number in the form. Fix: only show a toast (and only overwrite) when the synced
    // value actually differs from what's currently in the field, and never toast on
    // the very first sync of a modal session (loading existing variants on openEdit) —
    // only on syncs that happen as a *result* of the admin's own edits in this session.
    onPricingSync: (sell: string, base: string) => {
      setForm((f: ProductForm) => {
        const changed = String(f.selling_price ?? '') !== sell;
        if (changed && hasUserEditedVariantsRef.current) {
          showToast(`Selling price auto-updated to ₹${sell} to match the lowest active variant price.`, 'info');
        }
        return { ...f, selling_price: sell, price: base };
      });
    },
    onAlert:   (msg: string, type?: 'error' | 'success' | 'warning' | 'info') =>
      showToast(msg, type ?? 'warning'),
    onConfirm: (msg: string, opts?: { confirmLabel?: string; danger?: boolean }) =>
      showConfirm(msg, { confirmLabel: opts?.confirmLabel ?? 'Continue', danger: opts?.danger ?? false }),
  });

  // Thin wrappers that mark this modal session as "admin actively edited variants"
  // before delegating to the real hook functions -- see hasUserEditedVariantsRef above.
  const addVariant = useCallback(() => {
    hasUserEditedVariantsRef.current = true;
    addVariantRaw();
  }, [addVariantRaw]);
  const removeVariant = useCallback((i: number) => {
    hasUserEditedVariantsRef.current = true;
    removeVariantRaw(i);
  }, [removeVariantRaw]);
  const updateVariant = useCallback((i: number, key: keyof VariantRow, val: unknown) => {
    hasUserEditedVariantsRef.current = true;
    updateVariantRaw(i, key, val);
  }, [updateVariantRaw]);

  // Calls adjust_variant_stock directly for an *existing* variant (v._id set).
  // Applies immediately — independent of "Save Product" — and writes its own
  // audit row via the RPC (which itself relies on trg_fn_stock_change; see
  // stock_movements_source_check / inventory_ledger_event_type_check on the DB).
  const applyStockAdjust = useCallback(async (i: number) => {
    const v = variants[i];
    if (!v?._id) return;

    const rawDelta = stockAdjustDelta[i] ?? '';
    const delta    = parseInt(rawDelta, 10);
    if (isNaN(delta) || delta === 0) {
      showToast('Enter a non-zero amount to adjust stock by.', 'warning');
      return;
    }
    const reason = stockAdjustReason[i] || 'manual';

    setStockAdjustBusy(i);
    try {
      const result = await api.rpc('adjust_variant_stock', {
        p_variant_id:   v._id,
        p_delta:        delta,
        p_reason:       reason,
        p_reference_id: `admin_ui:${modal !== 'add' && modal ? (modal as Product).id : 'unknown'}`,
      });

      if (!result?.ok) {
        const reasonMsg = result?.error === 'concurrent_lock'
          ? 'Another update is in progress for this product — try again in a moment.'
          : result?.error === 'variant_not_found_or_inactive'
          ? 'This variant is inactive or no longer exists.'
          : result?.error || 'Stock adjustment failed.';
        showToast(reasonMsg, 'error');
        return;
      }

      // Reflect the new stock immediately in the open form. This intentionally
      // keeps variants[i].available_stock in sync with the DB, so a subsequent
      // "Save Product" computes a zero delta and doesn't re-apply this change.
      updateVariantRaw(i, 'available_stock', String(result.stock_after));
      setStockAdjustDelta(prev => ({ ...prev, [i]: '' }));
      showToast(
        `Stock updated: ${result.stock_before} → ${result.stock_after} (${delta > 0 ? '+' : ''}${delta})`,
        'success'
      );
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Stock adjustment failed.', 'error');
    } finally {
      setStockAdjustBusy(null);
    }
  }, [variants, stockAdjustDelta, stockAdjustReason, modal, updateVariantRaw, showToast]);
  const autoGenerateVariants = useCallback(async () => {
    hasUserEditedVariantsRef.current = true;
    await autoGenerateVariantsRaw();
  }, [autoGenerateVariantsRaw]);

  // ── ARCH FIX: Version history — useVersionHistory hook ───────────────────
  // Previously: 7 useState + openVersionHistory/rollbackToVersion/getSnapshotField
  // all inline. The hook's alert()/confirm() calls are also replaced.
  const {
    versionModal, setVersionModal,
    versions, versionsLoading,
    compareMode, setCompareMode,
    compareA, setCompareA,
    compareB, setCompareB,
    rollingBack,
    openVersionHistory,
    rollbackToVersion,
    getSnapshotField,
  } = useVersionHistory({
    onRollbackSuccess: () => { load(); },
    onAlert:   (msg: string, type?: 'error' | 'success' | 'warning' | 'info') =>
      showToast(msg, type ?? 'info'),
    onConfirm: (msg: string, opts?: { confirmLabel?: string; cancelLabel?: string; danger?: boolean }) =>
      showConfirm(msg, {
        confirmLabel: opts?.confirmLabel ?? 'Confirm',
        cancelLabel:  opts?.cancelLabel,
        danger:       opts?.danger ?? false,
      }),
  });

  // ── ARCH FIX: Image/video upload — useProductUploads hook ────────────────
  // Previously: imgModal, prodImages, uploading, uploadStatus, videoUploading,
  // videoUploadStatus + openImgModal/handleImageUpload/deleteImage/handleVideoUpload
  // all inline. Hook also fixed the sessionStorage XSS vector and duplicate
  // compressInWorker implementation.
  const productId = modal !== 'add' ? (modal as Product)?.id ?? null : null;
  const {
    uploading, uploadStatus,
    videoUploading, videoUploadStatus,
    prodImages, setProdImages,
    imgModal, setImgModal,
    loadImages,
    handleImageUpload: _handleImageUpload,
    deleteImage,
    handleVideoUpload: _handleVideoUpload,
  } = useProductUploads({
    productId,
    onImageSaved: (url: string) => {
      setForm((f: ProductForm) => ({ ...f, image_url: url }));
      if (productId) api.patch('products', `id=eq.${productId}`, { image_url: url }).catch(() => {});
    },
    onVideoSaved: (url: string) => {
      setForm((f: ProductForm) => ({ ...f, video_url: url }));
      if (productId) api.patch('products', `id=eq.${productId}`, { video_url: url }).catch(() => {});
    },
    onConfirm: (msg: string) => showConfirm(msg, { confirmLabel: 'Delete', danger: true }),
    // BUG FIX (Error Handling & UX): useProductUploads' deleteImage catch block
    // surfaces failures via onAlert, but this call site never supplied one — the
    // hook fell back to an undeclared `onAlert` reference (a build-breaking bug,
    // fixed in useProductUploads.ts) which meant a failed image delete had no path
    // to reach the admin at all. Wired to showToast, consistent with every other
    // hook used by this component (useVariants, useCatalogueAI, useVersionHistory).
    onAlert: (msg: string, type?: 'error' | 'success' | 'warning' | 'info') =>
      showToast(msg, type ?? 'error'),
  });

  // BUG FIX (PERF / STALE): These four wrappers were plain functions — recreated on
  // every render and passed as props/onClick to JSX. Each render gave consumers a new
  // function reference, preventing React.memo from optimising child components.
  // Wrapped in useCallback so references are stable across renders that don't change
  // the captured dependencies.
  const handleImageUpload = useCallback((files: File[]) => {
    if (!files.length) return;
    if (!productId) { showToast('Save the product first, then upload images.', 'warning'); return; }
    files.forEach(f => _handleImageUpload(f, productId));
  }, [productId, _handleImageUpload, showToast]);

  const handleVideoUpload = useCallback((file: File) => {
    if (!productId) { showToast('Save the product first, then upload a video.', 'warning'); return; }
    _handleVideoUpload(file, productId);
  }, [productId, _handleVideoUpload, showToast]);

  const openImgModal = useCallback(async () => {
    setImgModal(true);
    if (productId) await loadImages(productId);
    else setProdImages([]);
  }, [productId, loadImages, setProdImages, setImgModal]);

  // BUG FIX: autoGenerate was `async function autoGenerate() { await autoGenerateVariants(); }`
  // — a plain async function recreated every render. useCallback wraps it so the reference
  // is stable; the empty deps array is correct because autoGenerateVariants is already a
  // stable useCallback from useVariants.
  const autoGenerate = useCallback(async () => {
    await autoGenerateVariants();
  }, [autoGenerateVariants]);

  // ── AI content — useCatalogueAI hook ────────────────────────────────────
  // NOTE: must be declared BEFORE handleGenerateAI useCallback which references _handleGenerateAIHook
  const {
    aiLoading: aiLoadingHook,
    aiPreview, setAiPreview,
    aiSaved,   setAiSaved, aiError, setAiError,
    loadAiContent,
    handleGenerateAI: _handleGenerateAIHook,
    handleSaveAI,
    handleDiscardAI,
  } = useCatalogueAI({
    categories,
    onAlert:   (msg: string, type?: 'error' | 'success' | 'warning' | 'info') =>
      showToast(msg, type ?? 'info'),
    onConfirm: (msg: string, opts?: { confirmLabel?: string; danger?: boolean }) =>
      showConfirm(msg, { confirmLabel: opts?.confirmLabel ?? 'Continue', danger: opts?.danger ?? false }),
  });

  // BUG FIX: handleGenerateAI was a plain function — recreated every render, passed
  // as onClick to JSX, causing re-renders on every ProductsTab render.
  // Now a stable useCallback with precise deps. Declared after useCatalogueAI
  // because it references _handleGenerateAIHook from that destructure.
  const handleGenerateAI = useCallback(() => {
    if (!modal || modal === 'add') {
      showToast('Please save the product first before generating AI content.', 'warning');
      return;
    }
    _handleGenerateAIHook({
      productId:   (modal as Product).id,
      productName: form.name,
      categoryId:  Number(form.category_id),
      tags:        typeof form.tags === 'string' ? form.tags : '',
    });
  }, [modal, form.name, form.category_id, form.tags, _handleGenerateAIHook, showToast]);

  const gstHsnRules = useGstHsnRules();

  // gst_rates loading is now owned by useCatalogueData (see hook call above).

  // ── Pricing prefill from Pricing Engine ───────────────────────────────────
  // MEDIUM FIX (Audit M-5): Guard against re-triggering when the parent re-renders
  // and passes a structurally-identical but referentially-new prefillPricing object.
  // We compare by JSON serialization; only open the modal when the content actually changes.
  const lastPrefillRef = useRef<string | null>(null);
  useEffect(() => {
    if (!prefillPricing || typeof prefillPricing !== 'object') return;
    const serialized = JSON.stringify(prefillPricing);
    if (serialized === lastPrefillRef.current) return; // same content — skip
    lastPrefillRef.current = serialized;
    setForm({
      ...EMPTY_FORM,
      price:         String(prefillPricing.price         ?? ''),
      selling_price: String(prefillPricing.selling_price ?? ''),
      mrp:           String(prefillPricing.mrp_display   ?? ''),
      cost_price:    String(prefillPricing.cost_price    ?? ''),
      gst_rate:      prefillPricing.gst_rate             ?? 5,
    });
    setVariants([]);
    setModalTab('pricing');
    setModal('add');
  }, [prefillPricing]); // eslint-disable-line react-hooks/exhaustive-deps

  function safeParse<T>(str: unknown, fallback: T): T {
    if (!str) return fallback;
    try { return JSON.parse(str as string) as T; } catch { return fallback; }
  }

  // Data loading (products, categories, states, vendors, attrDefs, load(),
  // bulkStatusChange()) is now owned by useCatalogueData — see hook call above.
  useEffect(() => { setPage(0); setSelected(new Set()); }, [debouncedSearch, filterCat, filterSize, filterStock, setPage, setSelected]);
  useEffect(() => { setSelected(new Set()); }, [page, setSelected]);

  // Race-condition fix: sync state_id when states array loads AFTER modal opens
  useEffect(() => {
    if (!states.length || !modal || modal === 'add') return;
    const correctSid = String((modal as Product).state_id ?? '').trim();
    if (!correctSid) return;
    if (form.state_id !== correctSid) setForm(f => ({ ...f, state_id: correctSid }));
  }, [states]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── handleSellingPriceChange ──────────────────────────────────────────────
  // BUG FIX (PERF/STALE): handleSellingPriceChange was a plain function — recreated
  // on every render. Because it's passed as onChange to the selling price input AND
  // as the onClick argument for the "psychological price" button, both received a
  // new function reference on every render. Wrap in useCallback so the references
  // are stable across renders that don't change the captured state.
  const handleSellingPriceChange = useCallback((val: string) => {
    const sell_p = toPaise(val || 0);
    const rate   = Number(form.gst_rate) || 0;
    const base_p = removeGst(sell_p, rate);
    const base_r = toRupees(base_p);
    setForm(f => ({ ...f, selling_price: val, price: String(base_r) }));
    if (variants.length > 0 && sell_p > 0) {
      const gst = Number(form.gst_rate) || 5;
      setVariants(vs => vs.map(v => {
        if (!v.variant_value || !v._autoGenerated) return v;
        const calcd = calcVariantPrices(toRupees(sell_p), avBaseUnit || '250g', [v.variant_value], gst, variantStrategy);
        return { ...v, price: calcd[0]?.price ?? v.price, _base: calcd[0]?.original_price ?? v._base };
      }));
    }
  }, [form.gst_rate, variants.length, avBaseUnit, variantStrategy, setForm, setVariants]);

  // BUG-04 FIX: openEdit fired two fire-and-forget api.get() calls (attributes + variants)
  // with no stale-response guard. If the user clicked Edit on product A, then immediately
  // Edit on product B, the slower response for A could arrive after B's modal opened and
  // silently overwrite B's variants/attributes with A's data.
  // Fix: capture a requestId at the start of each openEdit call. Each .then() checks that
  // the modal product hasn't changed before calling setState.
  const openEditReqRef = useRef(0);

  function openEdit(p: Product) {
    hasUserEditedVariantsRef.current = false; // fresh modal session — initial variant load is silent
    const tags     = Array.isArray(p.tags) ? p.tags.join(', ') : (p.tags ?? '');
    const badges   = p.badges ?? [];
    const gstRate  = p.gst_rate ?? 5;
    const selling  = p.selling_price ?? 0;
    const base     = selling > 0 ? toRupees(removeGst(toPaise(selling), gstRate)) : (p.price ?? 0);
    const _stateId = p.state_id ? String(p.state_id).trim() : '';

    setForm({
      ...EMPTY_FORM,
      name:              p.name ?? '',
      slug:              p.slug ?? '',
      emoji:             p.emoji ?? '',
      status:            p.status ?? 'active',
      unit_label:        p.unit_label ?? '',
      gst_rate:          p.gst_rate ?? 5,
      short_description: p.short_description ?? '',
      price:             String(base || ''),
      selling_price:     String(selling || ''),
      mrp:               p.mrp != null ? String(p.mrp) : '',
      compare_at_price:  p.compare_at_price != null ? String(p.compare_at_price) : '',
      cost_price:        p.cost_price != null ? String(p.cost_price) : '',
      state_id:          _stateId,
      category_id:       p.category_id != null ? String(p.category_id) : '',
      vendor_id:         p.vendor_id != null ? String(p.vendor_id) : '',
      price_version:     p.price_version ?? 1,
      tags,
      badges_bestseller: badges.includes('bestseller'),
      badges_organic:    badges.includes('organic'),
      badges_new:        badges.includes('new'),
      long_description:  p.long_description ?? '',
      image_url:         p.image_url  ?? '',
      video_url:         p.video_url  ?? '',
      hsn_code:          p.hsn_code   ?? '',
      seo_title:         p.seo_title       ?? '',
      seo_description:   p.seo_description ?? '',
    });
    setMrpError('');
    setVariants([]);
    setAiPreview(null); setAiSaved(null); setAiError('');
    setModalTab('basic');
    setModal(p);
    loadAiContent(p.id);

    // BUG-04 FIX: stamp this openEdit call so stale responses from a prior
    // product don't overwrite state after a newer openEdit has fired.
    const reqId = ++openEditReqRef.current;

    api.get('product_attribute_values', `product_id=eq.${p.id}&select=attribute_id,value`)
      .then((vals: unknown) => {
        if (openEditReqRef.current !== reqId) return; // stale — discard
        const map: Record<number, string> = {};
        castArray<{ attribute_id: number; value: string }>(vals, 'attribute_values')
          .forEach(v => { map[v.attribute_id] = v.value; });
        setAttrValues(map);
      }).catch(() => {}); // non-fatal: attribute values are metadata, not core product data
    api.get('product_variants', `product_id=eq.${p.id}&order=sort_order.asc`)
      .then((vars: unknown) => {
        if (openEditReqRef.current !== reqId) return; // stale — discard
        const loaded: VariantRow[] = castArray<VariantRowDB>(vars, 'product_variants')
          .map(v => normalizeVariantRow(v));
        setVariants(loaded);
        syncPricingFromVariants(loaded, gstRate);
      }).catch((e: unknown) => {
        // BUG FIX: previously `.catch(() => {})` — variant load failure was silently
        // swallowed. The modal would open with setVariants([]) (empty) but no error,
        // making it look like the product has no variants. The admin could then
        // inadvertently save with an empty variant list, wiping all existing variants.
        // Fix: surface as a toast so the admin knows to close and retry.
        if (openEditReqRef.current !== reqId) return; // stale — still discard silently
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[openEdit] variant load failed:', msg);
        showToast(`Failed to load variants for "${sanitizeText(p.name)}" — ${msg}. Close and reopen to retry.`, 'error');
      });
  }

  function openAdd() {
    hasUserEditedVariantsRef.current = false;
    setForm(EMPTY_FORM); setVariants([]); setModalTab('basic');
    setAiPreview(null); setAiSaved(null); setAiError(''); setMrpError('');
    setModal('add');
  }

  // ── save ──────────────────────────────────────────────────────────────────
  async function save() {
    const hasSellPrice = form.selling_price || form.price || form.mrp;
    if (!form.name || !hasSellPrice) { showToast('Name and Selling Price are required', 'error'); return; }
    const _sid = form.state_id ? String(form.state_id).trim() : '';
    if (!_sid) { showToast('Please select a State for this product', 'error'); return; }
    if (variants.length === 0) { showToast('At least one variant is required. Use ⚡ Auto-generate or + Add Variant.', 'error'); return; }

    const missingStock = variants.filter(v =>
      v.variant_value && v.price && !v._id &&
      (!v.initial_stock || parseInt(v.initial_stock, 10) <= 0)
    );
    if (missingStock.length > 0) {
      // SECURITY FIX (CRITICAL): sanitize variant_value before injecting into UI string.
      // variant_value is user-supplied; strip HTML/script content before display.
      showToast(`Initial Stock required for: ${missingStock.map(v => sanitizeText(v.variant_value)).join(', ')}`, 'error');
      return;
    }

    const varVals = variants.map(v => v.variant_value?.toLowerCase().trim()).filter(Boolean);
    if (varVals.length !== new Set(varVals).size) {
      showToast('Duplicate variant sizes — each variant must be unique.', 'error');
      return;
    }

    const sellingPrice = parseInputFloat(form.selling_price) || 0;
    const gstRate      = Number(form.gst_rate) || 5;
    const basePrice    = toRupees(removeGst(toPaise(sellingPrice), gstRate));
    const legalMrp     = parseInputFloat(form.mrp) || sellingPrice;
    const compareAt    = parseInputFloat(form.compare_at_price) || legalMrp;
    const costPrice    = parseInputFloat(form.cost_price) || null;

    if (legalMrp > 0 && legalMrp < sellingPrice) {
      setMrpError(`Legal MRP (₹${legalMrp}) cannot be less than Selling Price (₹${sellingPrice.toFixed(0)})`);
      showToast(`Legal MRP (₹${legalMrp}) cannot be less than Selling Price (₹${sellingPrice.toFixed(0)})`, 'error');
      return;
    }
    if (costPrice && sellingPrice > 0) {
      const grossMargin = (sellingPrice - costPrice) / sellingPrice * 100;
      if (grossMargin < 0) { showToast('Selling price is BELOW cost price — you would lose money on every sale.', 'error'); return; }
      if (grossMargin < MIN_MARGIN_WARN_PCT) {
        const proceed = await showConfirm(
          `Gross margin is only ${grossMargin.toFixed(1)}% — below the safe threshold of ${MIN_MARGIN_WARN_PCT}%. After logistics, returns, and platform fees this product may run at a loss. Continue anyway?`,
          { confirmLabel: 'Save anyway', cancelLabel: 'Go back', danger: true }
        );
        if (!proceed) return;
      }
    }

    setSaving(true);
    try {
      const badges = [];
      if (form.badges_bestseller) badges.push('bestseller');
      if (form.badges_organic)    badges.push('organic');
      if (form.badges_new)        badges.push('new');
      const tags    = form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
      const stateId = _sid || null;
      if (!stateId) { setSaving(false); showToast('Please select a valid State', 'error'); return; }

      // BUG FIX (Audit finding #9): enforce SEO field character limits before
      // the DB write, same defense-in-depth pattern as CategoriesTab.
      if ((form.seo_title?.length ?? 0) > SEO_TITLE_MAX) {
        setSaving(false);
        showToast(`SEO Title is too long (${form.seo_title?.length ?? 0} chars). Maximum is ${SEO_TITLE_MAX}.`, 'error');
        return;
      }
      if ((form.seo_description?.length ?? 0) > SEO_DESC_MAX) {
        setSaving(false);
        showToast(`SEO Description is too long (${form.seo_description?.length ?? 0} chars). Maximum is ${SEO_DESC_MAX}.`, 'error');
        return;
      }

      const body = {
        name: sanitizeText(form.name),
        slug: sanitizeText(form.slug) || slugify(sanitizeText(form.name)),
        emoji: form.emoji || null,
        category_id: form.category_id && form.category_id !== '' ? parseInt(form.category_id, 10) : null,
        hsn_code: form.hsn_code || null,
        state_id: stateId,
        vendor_id: form.vendor_id && form.vendor_id !== '' ? parseInt(form.vendor_id, 10) : null,
        status: form.status,
        unit_label: sanitizeText(form.unit_label) || null,
        gst_rate: gstRate,
        price: basePrice,
        selling_price: sellingPrice,
        mrp: legalMrp,
        compare_at_price: compareAt,
        cost_price: costPrice,
        short_description: sanitizeText(form.short_description) || null,
        long_description: sanitizeText(form.long_description) || null,
        seo_title: sanitizeText(form.seo_title) || null,
        seo_description: sanitizeText(form.seo_description) || null,
        // SECURITY FIX: Only persist image_url if it passes the allow-list check.
        // Prevents javascript:/data: URIs being stored in the DB and later served to customers.
        image_url: isSafeImageUrl(form.image_url) ? form.image_url : null,
        // SECURITY FIX: Only persist video_url if it passes the allow-list check.
        video_url: isSafeVideoUrl(form.video_url) ? form.video_url : null,
        tags: tags.length ? tags.map(sanitizeText).filter(Boolean) : null,
        badges: badges.length ? badges : null,
        available_stock: 0,
      };

      let prodId: number | null = modal === 'add' ? null : (modal as Product).id;

      if (modal === 'add') {
        // TYPE FIX: castItem handles both array[0] and single-object responses
        const r   = await api.post('products', { ...body, is_deleted: false });
        const obj = castMaybe<{ id?: number }>(r);
        prodId    = obj?.id ?? null;
        if (!prodId) throw new Error('Product created but ID not returned — please check.');
      } else {
        const lockRes = await api.rpc('update_product_with_version', {
          p_id: (modal as Product).id,
          p_expected_version: form.price_version || 1,
          p_body: body,
        }).catch((err: unknown) => {
          // NEW BUG FIX: previously `.catch(() => null)` swallowed ALL RPC errors,
          // including real failures (network, auth, DB outage). null was then tested
          // for `lockRes?.ok === false && lockRes?.conflict` — both are undefined on
          // null, so the conflict check never fired and execution fell through to
          // `api.patch(...)` on the next line — making a SECOND write attempt on a
          // product whose first write had already failed.
          //
          // Fix: re-throw non-conflict errors so they bubble to the outer catch and
          // surface as a proper error toast. Only swallow the response when
          // `update_product_with_version` returns a structured `{ok,conflict}` object
          // (i.e. when the RPC itself succeeded but detected a version conflict).
          // A null/undefined return from the RPC means something went wrong.
          throw err;
        }) as { ok?: boolean; conflict?: boolean } | null;
        if (lockRes?.ok === false && lockRes?.conflict) {
          // UX-6 FIX: setSaving(false) was called before the showConfirm await, but
          // if the user picks "Reload" and we call setModal(null) + load(), React
          // unmounts the modal while saving=true is still set in its closure — the
          // spinner on the Save button freezes until the component remounts. Setting
          // saving=false BEFORE setModal(null) ensures the button resets cleanly
          // regardless of which branch the user picks.
          setSaving(false);
          const latestRows = await api.get('products', `id=eq.${(modal as Product).id}&select=price_version`).catch(() => null);
          // TYPE FIX: castMaybe returns null on unexpected shape
          const latest     = castMaybe<{ price_version?: number }>(latestRows);
          const latestVer = latest?.price_version ?? '?';
          const confirmed = await showConfirm(
            `Version conflict — the database is now at v${latestVer} but you were editing v${form.price_version || 1}. Click "Reload" to discard your changes and reload, or "Keep editing" to continue.`,
            { confirmLabel: 'Reload (discard changes)', cancelLabel: 'Keep editing', danger: true }
          );
          if (confirmed) { setModal(null); load(); }
          return;
        }
        // BUG FIX (CRITICAL — double-write / broken optimistic lock):
        // The api.patch() call that was here was UNCONDITIONAL — it always fired
        // after update_product_with_version, even on success.
        //
        // update_product_with_version already writes ALL fields to the DB AND
        // atomically increments price_version. The api.patch() that followed then
        // overwrote the row a second time with the same `body` — but WITHOUT
        // incrementing price_version, so the version counter stalled at its
        // initial value (1) forever, rendering the entire optimistic-locking
        // mechanism permanently inoperative: every concurrent edit would succeed
        // without ever seeing a version conflict.
        //
        // Fix: trust the RPC result. If it reached here (no conflict thrown), the
        // write succeeded — set prodId and continue to saveVariants().
        prodId = (modal as Product).id;
      }

      if (prodId) await saveVariants(prodId);

      // Silent background AI generation
      const needsAI = modal === 'add' || !form.short_description?.trim();
      if (needsAI && prodId) {
        const _aiKey = `ai_inflight_${prodId}`;
        if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(_aiKey)) {
          if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(_aiKey, '1');
          const catName = categories.find(c => String(c.id) === String(form.category_id))?.name ?? '';
          fetch('/api/admin', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'generate_ai_content', productId: prodId, name: form.name, category: catName, ingredients: typeof form.tags === 'string' ? form.tags : '' }),
          }).catch(() => {}).finally(() => { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(_aiKey); });
        }
      }

      // BUG-23 FIX: api.upsert('product_attribute_values', {...}) was broken for the
      // same reason as the original BUG-08 issue — api.upsert() sends the literal
      // HTTP method string "UPSERT" to Supabase's PostgREST endpoint
      // (src/lib/api.js → sbFetch(method,...) → fetch(url, { method: 'UPSERT' })).
      // PostgREST does not recognize "UPSERT" as a verb, and src/app/api/admin/
      // route.js has no translation to POST + `Prefer: resolution=merge-duplicates`
      // + `on_conflict=...`. Every call here failed at the HTTP layer and was
      // silently swallowed by `.catch(() => {})` — custom attribute values were
      // NEVER actually persisted, with zero indication to the admin.
      //
      // Fixed with the same proven POST-then-PATCH-on-conflict pattern used
      // elsewhere in this codebase (api.post rejects on non-2xx → .catch() runs
      // → api.patch updates the existing row). Both api.post and api.patch send
      // standard HTTP methods that the backend already handles correctly.
      if (prodId && Object.keys(attrValues).length > 0) {
        const attrUpserts = Object.entries(attrValues)
          .filter(([, value]) => value || value === '0')
          .map(([attrId, value]) => {
            const attributeId = parseInt(attrId, 10);
            return api.post('product_attribute_values', {
              product_id:   prodId,
              attribute_id: attributeId,
              value:        String(value),
            }).catch(() =>
              api.patch('product_attribute_values',
                `product_id=eq.${prodId}&attribute_id=eq.${attributeId}`,
                { value: String(value) },
              )
            ).catch(() => {}); // last-resort: don't block the rest of save() on one attr failing
          });
        await Promise.all(attrUpserts);
      }

      // BUG-14 FIX: This block previously fetched product_variants AND products
      // (for price_version) again here, then called setVariants()/setForm() with
      // the results — immediately followed by setModal(null) on the next line,
      // which unmounts the modal and discards both state updates.
      //
      // Net effect: every single save() (add OR edit) made 2 completely wasted
      // API round-trips:
      //   1. api.get('product_variants', `product_id=eq.${prodId}...`)
      //   2. api.get('products', `id=eq.${prodId}&select=price_version`)
      // — on top of the fetches already done inside saveVariants(prodId) above,
      // and the fetches load() is about to do for the product list/page.
      //
      // For a product with 5 variants, that's ~3 redundant network calls per save.
      // Removed entirely: load() (called below) already refreshes the product list
      // with up-to-date _variantCount / variantStockMap / price_version for the
      // current page, which is all the UI shows once the modal closes.
      setModal(null); setMrpError(''); load();
    } catch (e: unknown) {
      showToast('Error saving: ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally { setSaving(false); }
  }

  async function saveVariants(prodId: number) {
    // FIX (MAINTAINABILITY): Use the memoized component-level catMap (useMemo below)
    // instead of rebuilding Object.fromEntries(categories.map(...)) on every call.
    // TYPE FIX: castArray validates shape; the old `as (VariantRow & {id:number})[]`
    // cast would silently succeed on an error object and crash on .filter() below.
    const dbVars = castArray<VariantRowDB>(
      await api.get('product_variants', `product_id=eq.${prodId}`).catch(() => []),
      'product_variants',
    );
    const keptIds  = new Set(variants.filter(v => v._id).map(v => String(v._id)));
    const keptVals = new Set(variants.map(v => v.variant_value?.toLowerCase().trim()).filter(Boolean));
    const toDelete = (dbVars || []).filter(dbV =>
      !keptIds.has(String(dbV.id)) && !keptVals.has(dbV.variant_value?.toLowerCase().trim())
    );
    if (toDelete.length > 0) {
      await Promise.all(toDelete.map(dbV => api.delete('product_variants', `id=eq.${dbV.id}`).catch(() => {})));
      // FIX (HIGH): Removed hardcoded setTimeout(400ms) — Promise.all above already
      // awaits all deletes. Re-fetching immediately after is safe.
    }
    // BUG-05 FIX: The second api.get('product_variants') fired unconditionally — even
    // when toDelete was empty (the common case: no variants removed). This meant every
    // save() made two round-trips to fetch the same data.
    // Fix: only re-fetch after actual deletes. When nothing was deleted, dbVars is
    // still accurate (no rows were removed), so reuse it directly.
    const freshDbVars = toDelete.length > 0
      ? castArray<VariantRowDB>(
          await api.get('product_variants', `product_id=eq.${prodId}`).catch(() => []),
          'product_variants (post-delete)',
        )
      : dbVars; // nothing deleted — dbVars is still correct
    const dbByVal = Object.fromEntries((freshDbVars || []).map(v => [v.variant_value?.toLowerCase().trim(), v]));

    // FIX (HIGH): Replaced serial for-loop with Promise.all so all variant saves
    // fire concurrently. 10 variants previously = ~10 serial round-trips (~2-3s);
    // now they complete in ~1 round-trip time. Each variant's work is independent:
    //   • sort_order uses the captured index `i` from the map closure — stable.
    //   • The SKU uniqueness retry loop (for...attempt) is still sequential *within*
    //     one variant but parallel *across* variants. Since SKUs are derived from
    //     name+variant_value+category (all unique per variant), cross-variant SKU
    //     collisions are impossible; only DB collisions with other products trigger retries.
    await Promise.all(variants.map(async (v, i) => {
      if (!v.variant_value || !v.price) return;
      // BUG FIX (CRITICAL): `parseInt(...) || fallback` treats 0 as falsy.
      // A variant with available_stock=0 fell through to initialStock, resetting
      // stock to the initial purchase quantity on every save — live inventory was
      // silently overwritten. Same issue with initialStock calculation.
      // Fix: only fall through when parseInt returns NaN (truly missing value).
      const parsedInitial   = parseInt(v.initial_stock, 10);
      const parsedAvailable = parseInt(v.available_stock, 10);
      const initialStock    = !isNaN(parsedInitial)   ? parsedInitial
                            : !isNaN(parsedAvailable) ? parsedAvailable
                            : 0;
      const stockQty        = !isNaN(parsedAvailable) ? parsedAvailable : initialStock;
      const sellPrice    = parseFloat(v.price) || 0;
      const gst          = Number(form.gst_rate) || 5;
      const baseP        = parseFloat(v._base ?? '') || toRupees(removeGst(toPaise(sellPrice), gst));
      const vBody = {
        product_id: prodId,
        variant_type: v.variant_type || 'weight',
        variant_value: v.variant_value,
        sku: v.sku || generateSku(form.name, v.variant_value, (catMap[String(form.category_id)] ?? '')),
        price: sellPrice,
        original_price: baseP,
        available_stock: stockQty,
        initial_stock: initialStock,
        orders_reserved: v.orders_reserved ?? 0,
        is_active: v.is_active !== false,
        sort_order: i,
      };
      try {
        const existingById  = v._id ? String(v._id) : null;
        const existingByVal = dbByVal[v.variant_value?.toLowerCase().trim()];
        if (!existingById && !existingByVal && vBody.sku) {
          let finalSku = vBody.sku;
          for (let attempt = 0; attempt < 5; attempt++) {
            const hit = await api.rpc('sku_exists', { p_sku: finalSku, p_exclude_variant_id: null }).catch(() => false);
            if (!hit) break;
            finalSku = generateSku(form.name, v.variant_value, catMap[String(form.category_id)] ?? '');
          }
          vBody.sku = finalSku;
        }
        if (existingById)        await api.patch('product_variants', `id=eq.${existingById}`, vBody);
        else if (existingByVal)  await api.patch('product_variants', `id=eq.${existingByVal.id}`, vBody);
        else                     await api.post('product_variants', vBody);
      } catch (e: unknown) {
        throw new Error(`Variant "${v.variant_value}" failed: ${(e instanceof Error ? e.message : String(e))}`);
      }
    }));
  }

  // addVariant, removeVariant, updateVariant, syncPricingFromVariants, autoGenerate
  // are now all owned by useVariants hook (wired above). catMap is also defined above.

  function toggleSelect(id: number) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleSelectAll() {
    setSelected(s => s.size === filtered.length ? new Set() : new Set(filtered.map(p => p.id)));
  }

  async function bulkArchive() {
    if (selected.size === 0) return;
    if (!await showConfirm(`Archive ${selected.size} product${selected.size !== 1 ? "s" : ""}? This marks them as archived.`, { confirmLabel: "Archive", danger: true })) return;
    setBulkLoading(true);
    try {
      const ids = [...selected];
      await api.patch('products', `id=in.(${ids.join(',')})`, { status: 'archived', is_deleted: true, deleted_at: new Date().toISOString() });
      setSelected(new Set()); load();
    } catch (e: unknown) { showToast('Error archiving: ' + (e instanceof Error ? e.message : String(e)), 'error'); }
    finally { setBulkLoading(false); }
  }

  // bulkStatusChange is now owned by useCatalogueData (see hook call above).
  // bulkArchive stays here — it's a distinct action (soft-delete + archive
  // flag) that was never part of the data-loading hook's scope.

  function exportCSV() {
    const cols: (keyof Product)[] = ['id','name','status','category_id','selling_price','mrp','cost_price','gst_rate','available_stock'];
    const header = cols.join(',');
    // FIX (SECURITY): CSV formula injection — values starting with = + - @ are
    // interpreted as formulas by Excel/Sheets. Prefix them with a tab char so
    // spreadsheet apps treat them as text. Also wrap any value containing a comma
    // or double-quote in double-quotes, and escape inner double-quotes per RFC 4180.
    const safeCsvCell = (val: unknown): string => {
      let s = String(val ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = '\t' + s;       // neutralise formula prefix
      if (s.includes('"')) s = s.replace(/"/g, '""');   // RFC 4180 quote escaping
      if (s.includes(',') || s.includes('"') || s.includes('\n')) s = `"${s}"`;
      return s;
    };
    const rows = filtered.map(p => cols.map(c => safeCsvCell(p[c])).join(','));
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `catalogue-export-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  // openVersionHistory, rollbackToVersion, getSnapshotField are now all owned by
  // the useVersionHistory hook (wired above in the state block).

  // autoGenerate, handleImageUpload, handleVideoUpload, openImgModal are all
  // useCallback-wrapped wrappers defined above (BUG FIX: were plain functions).

  async function softDeleteProduct(p: Product) {
    // SECURITY FIX: sanitize p.name — it is user-supplied DB data; strip HTML before injecting into dialog
    const safeName = sanitizeText(p.name);
    if (!await showConfirm(`Archive "${safeName}"? It will be hidden from the storefront.`, { confirmLabel: 'Archive', danger: true })) return;
    try {
      await api.patch('products', `id=eq.${p.id}`, { is_deleted: true, deleted_at: new Date().toISOString(), status: 'archived' });
      load();
    } catch (e: unknown) {
      // MEDIUM FIX (Audit W-6): also log to console so errors aren't silently swallowed
      // if the toast context is unmounted at the time of the error.
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[softDeleteProduct]', msg);
      try { showToast('Error archiving: ' + msg, 'error'); } catch { /* toast context gone */ }
    }
  }

  async function restoreProduct(p: Product) {
    // SECURITY FIX: sanitize p.name — user-supplied, strip HTML before display
    const safeName = sanitizeText(p.name);
    if (!await showConfirm(`Restore "${safeName}" back to Active?`, { confirmLabel: 'Restore', danger: false })) return;
    try {
      await api.patch('products', `id=eq.${p.id}`, { is_deleted: false, deleted_at: null, status: 'active' });
      load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[restoreProduct]', msg);
      try { showToast('Error restoring: ' + msg, 'error'); } catch { /* toast context gone */ }
    }
  }

  async function toggleStatus(p: Product) {
    const next = p.status === 'active' ? 'out_of_stock' : 'active';
    try {
      await api.patch('products', `id=eq.${p.id}`, { status: next });
      load();
    } catch (e: unknown) {
      // UX-2 FIX: toggleStatus had no try/catch at all. A network failure would
      // silently swallow the error — the row badge visually snapped back (because
      // load() never fired) but the admin had no toast, no message, and no way to
      // know whether the status change persisted or not. Added the same pattern
      // used by softDeleteProduct/restoreProduct directly below.
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[toggleStatus]', msg);
      showToast('Error updating status: ' + msg, 'error');
    }
  }

  // softDeleteProduct, restoreProduct, toggleStatus stay inline (product list ops)

  // parseGrams: converts variant size strings to grams for sort order in allSizes.
  // Kept here (not in useVariants) because it sorts the product-list allSizes
  // derived from variantStockMap — a page-level concern, not a form/variant concern.
  function parseGrams(unit: string): number {
    const s = String(unit).toLowerCase().trim();
    if (s.includes('kg')) return parseFloat(s) * 1000;
    if (s.includes('ml')) return parseFloat(s);
    if (s.endsWith('l') && !s.includes('ml')) return parseFloat(s) * 1000;
    if (s.includes('g')) return parseFloat(s);
    return 250;
  }

  // BUG FIX (PERF): calcGST was called as a plain function during render —
  // recomputed on every render regardless of whether selling_price, gst_rate, or
  // state_id changed. Wrap in useMemo so it only recomputes when inputs change.
  const gst = useMemo(() => {
    const sell_p = toPaise(form.selling_price || 0);
    const rate   = Number(form.gst_rate) || 0;
    const base_p = removeGst(sell_p, rate);
    const gst_p  = sell_p - base_p;
    const cgst_p = Math.floor(gst_p / 2);
    const sgst_p = gst_p - cgst_p;
    const storeStateId   = process.env.NEXT_PUBLIC_STORE_STATE_ID || '';
    const productStateId = String(form.state_id || '');
    const isInterstate   = storeStateId && productStateId && productStateId !== storeStateId;
    return {
      base:         toRupees(base_p).toFixed(2),
      gstAmt:       toRupees(gst_p).toFixed(2),
      selling:      toRupees(sell_p).toFixed(2),
      cgst:         toRupees(cgst_p).toFixed(2),
      sgst:         toRupees(sgst_p).toFixed(2),
      igst:         toRupees(gst_p).toFixed(2),
      isInterstate: !!isInterstate,
    };
  }, [form.selling_price, form.gst_rate, form.state_id]);

  // BUG FIX (found while auditing catalogue Error Handling & UX): "Filter by Size"
  // was wired up everywhere EXCEPT here — it fed the dropdown (filterSize state),
  // the page-reset effect, and hasFilter, and was even applied per-row further
  // down (displayVars), but never to this products-level filter. The practical
  // effect: selecting a size did NOT remove non-matching products from the list
  // or the "Products (N)" count, AND for any product with zero variants of that
  // size, the per-row `displayVars` filter (further below) would come back empty
  // and silently fall back to showing ALL of that product's variants — so picking
  // a size filter looked like it did almost nothing. Fixed by requiring at least
  // one variant per product to satisfy BOTH the size and stock filters together
  // (matching the same per-variant logic already used for displayVars).
  const filtered = useMemo(() => products.filter(p => {
    if (!filterSize && !filterStock) return true;
    const vars = variantStockMap[p.id] || [];
    const match = vars.some(v => {
      if (filterSize && v.variant_value !== filterSize) return false;
      if (filterStock === 'out' && v.available_stock !== 0) return false;
      if (filterStock === 'low' && !(v.available_stock > 0 && v.available_stock <= 5)) return false;
      if (filterStock === 'ok' && !(v.available_stock > 10)) return false;
      return true;
    });
    return match;
  }), [products, variantStockMap, filterSize, filterStock]);

  const hasFilter = search || filterCat || filterSize || filterStock;
  const allSizes  = useMemo(() =>
    [...new Set(products.flatMap(p => (variantStockMap[p.id] || []).map(v => v.variant_value)).filter(Boolean))].sort((a, b) => parseGrams(a) - parseGrams(b)),
    [products, variantStockMap],
  );
  const totalVariants = useMemo(() =>
    filtered.reduce((s, p) => s + (variantStockMap[p.id] || []).length, 0),
    [filtered, variantStockMap],
  );

  const sellingF   = parseFloat(form.selling_price as string) || 0;
  const costF      = parseFloat(form.cost_price) || 0;
  const liveMargin = sellingF > 0 && costF > 0 ? (sellingF - costF) / sellingF * 100 : null;
  const liveHealth = liveMargin !== null ? marginHealth(liveMargin) : null;
  const liveMeta   = liveHealth ? MARGIN_LABELS[liveHealth] : null;
  const psySell    = sellingF > 0 ? psychologicalRound(sellingF) : null;

  // ── Skeleton loading ──────────────────────────────────────────────────────
  if (loading) return (
    // MEDIUM FIX (Audit A-7): Add role=status + aria-live so screen readers announce loading state
    <div className="space-y-4" role="status" aria-live="polite" aria-busy="true" aria-label="Loading products…">
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {[180, 120, 80].map((w, i) => (
          <div key={i} style={{ width: w, height: 32, borderRadius: 8, background: 'var(--bg2,#161b22)', animation: 'pulse 1.4s ease-in-out infinite', opacity: 0.7 }} />
        ))}
      </div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, background: 'var(--bg2,#161b22)', border: '0.5px solid var(--bd,#1a5c2a)', animation: 'pulse 1.4s ease-in-out infinite', animationDelay: `${i * 80}ms`, opacity: 0.6 }}>
          <div style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--bg,#0d1117)', flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ width: `${45 + (i % 4) * 12}%`, height: 11, borderRadius: 4, background: 'var(--bg,#0d1117)' }} />
            <div style={{ width: '25%', height: 9, borderRadius: 4, background: 'var(--bg,#0d1117)' }} />
          </div>
          <div style={{ width: 56, height: 20, borderRadius: 20, background: 'var(--bg,#0d1117)' }} />
        </div>
      ))}
      <style>{`@keyframes pulse { 0%,100%{opacity:.6} 50%{opacity:1} }`}</style>
    </div>
  );

  if (error) return <ErrorMsg error={error} onRetry={load} />;

  return (
    <div className="space-y-4">
      {/* In-page notification overlays — replace browser alert()/confirm() */}
      <ToastDisplay toast={toast} />
      <ConfirmDisplay confirmState={confirmState} onResolve={handleResolve} />

      {/* ── Image Upload Sub-Modal ── */}
      {imgModal && (
        <AccessibleModal title="📸 Product Media" onClose={() => setImgModal(false)} width="480px" nested>
          {/* BUG FIX: this modal is opened by a button *inside* the still-open
              product Add/Edit modal below — `nested` ensures it actually paints
              on top instead of being hidden behind it (see AccessibleModal.tsx). */}
          {prodImages.length > 0 ? (
            <div className="flex flex-wrap gap-2 mb-4">
              {prodImages.map((img, i) => (
                <div key={img.id} className="relative">
                  {/* SECURITY FIX: allow-list check — only render known-safe image URLs */}
                  {isSafeImageUrl(img.image_url) && (
                  <img src={img.image_url} alt={`Product image ${i + 1}`}
                    className="rounded-lg object-cover border-2"
                    style={{ width: i === 0 ? '100%' : '72px', height: i === 0 ? '160px' : '72px', borderColor: i === 0 ? 'var(--accent,#1a5c2a)' : 'var(--bd,#1a5c2a)' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.3'; }} />
                  )}
                  <div className="absolute top-1 left-1 text-[8px] font-bold px-1 rounded" style={{ background: 'rgba(0,0,0,0.7)', color: '#fff' }}>{i === 0 ? 'Main' : `#${i + 1}`}</div>
                  <button
                    onClick={() => { if (productId) deleteImage(img.id, productId); }}
                    aria-label={`Delete image ${i + 1}`}
                    disabled={!productId}
                    className="absolute top-1 right-1 w-4 h-4 rounded text-[var(--tx)] flex items-center justify-center text-[10px]"
                    style={{ background: 'rgba(220,50,50,0.85)' }}>×</button>
                </div>
              ))}
            </div>
          ) : (
            // A11Y-8 FIX (WCAG 1.4.3): Tailwind's text-gray-500/600 (#6b7280/#4b5563)
            // measured only 2.0–3.9:1 against this dark UI's backgrounds — all below
            // the 4.5:1 minimum for normal text. Replaced with var(--tx2) (#8b949e,
            // 4.95–6.15:1) throughout this file's empty-states, legends, "Clear"
            // button, and variant hint text, consistent with the var(--tx3)→
            // var(--tx2) fix above (A11Y-5).
            <div className="text-center py-6 text-[12px] text-[var(--tx2)] mb-4">
              {modal === 'add' || !(modal as Product)?.id ? 'Save product first to upload images' : 'No images yet'}
            </div>
          )}
          {modal !== 'add' && (modal as Product)?.id && (
            <div className="space-y-2">
              <label htmlFor="img-upload" className="block text-[10px] font-bold uppercase tracking-wider text-[var(--tx2)]">Upload New Images</label>
              <input id="img-upload" type="file" accept="image/*" multiple
                aria-label="Upload product images"
                onChange={e => handleImageUpload(Array.from(e.target.files ?? []))}
                disabled={uploading}
                className="w-full text-[12px] text-[var(--tx2)] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-[11px] file:font-bold file:text-[var(--tx)] cursor-pointer" />
              {uploadStatus && (
                <div role="status" className="text-[11px] mt-1" style={{ color: uploadStatus.startsWith('✅') ? '#3fb950' : uploadStatus.startsWith('❌') ? '#f85149' : '#d29922' }}>
                  {uploadStatus}
                </div>
              )}
            </div>
          )}
          {/* Video */}
          <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--bd)' }}>
            <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--tx2)' }}>🎬 Product Video (optional)</div>
            {/* SECURITY FIX: Only render video preview for allow-listed URLs */}
            {isSafeVideoUrl(form.video_url) ? (
              <div className="mb-3">
                <video src={form.video_url} controls className="w-full rounded-lg" style={{ maxHeight: '160px', border: '1px solid var(--bd)', background: '#000' }} aria-label="Product video preview" />
                <button onClick={() => { setForm(f => ({ ...f, video_url: '' })); if ((modal as Product)?.id) api.patch('products', `id=eq.${(modal as Product).id}`, { video_url: null }).catch(() => {}); }}
                  aria-label="Remove product video"
                  className="mt-2 px-2 py-1 rounded text-[11px] font-bold"
                  style={{ background: 'rgba(248,81,73,0.12)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>
                  ✕ Remove
                </button>
              </div>
            ) : null}
            {modal !== 'add' && (modal as Product)?.id && (
              <>
                <label htmlFor="video-upload" className="sr-only">Upload product video</label>
                <input id="video-upload" type="file" accept="video/mp4,video/webm,video/ogg,video/quicktime,.mp4,.webm,.mov"
                  onChange={e => handleVideoUpload(e.target.files![0])}
                  disabled={videoUploading}
                  className="w-full text-[12px] text-[var(--tx2)] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-[11px] file:font-bold file:text-[var(--tx)] cursor-pointer" />
                <div className="text-[10px] mt-1" style={{ color: 'var(--tx2)' }}>MP4, WebM or MOV · Max 500MB</div>
                {/* MEDIUM FIX (Audit W-7): Add aria-live so screen readers announce upload progress */}
                {videoUploadStatus && <div role="status" aria-live="polite" aria-atomic="true" className="text-[11px] mt-1" style={{ color: videoUploadStatus.startsWith('✅') ? '#3fb950' : videoUploadStatus.startsWith('❌') ? '#f85149' : '#d29922' }}>{videoUploadStatus}</div>}
              </>
            )}
          </div>
        </AccessibleModal>
      )}

      {/* ── Version History Modal ── */}
      {versionModal && (
        <AccessibleModal title={`📦 Version History — ${versionModal.name}`} onClose={() => setVersionModal(null)} width="860px">
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button onClick={() => setCompareMode(c => !c)}
              aria-pressed={compareMode}
              aria-label={compareMode ? 'Exit compare mode' : 'Enter compare mode'}
              style={{ fontSize: 11, padding: '6px 12px', borderRadius: 6, border: '1px solid var(--bd)', background: compareMode ? 'rgba(88,166,255,0.15)' : 'transparent', color: compareMode ? '#58a6ff' : 'var(--tx2)', cursor: 'pointer' }}>
              {compareMode ? '✕ Compare Mode' : '⚖ Compare Versions'}
            </button>
          </div>
          {compareMode && compareA && compareB && (
            <div style={{ padding: '12px', background: 'rgba(88,166,255,0.05)', borderRadius: 8, border: '1px solid var(--bd)', marginBottom: 12 }}
              role="region" aria-label={`Comparing version ${compareA.version_number} and version ${compareB.version_number}`}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {['name','selling_price','mrp','cost_price','gst_rate','status'].map(field => {
                  const vA = getSnapshotField(compareA, field);
                  const vB = getSnapshotField(compareB, field);
                  const diff = vA !== vB;
                  return (
                    <div key={field} style={{ fontSize: 11 }}>
                      <span style={{ color: 'var(--tx2)', fontWeight: 600, textTransform: 'uppercase', fontSize: 9, marginRight: 8 }}>{field}:</span>
                      <span style={{ color: diff ? '#ffa600' : 'var(--tx)' }}>v{compareA.version_number}: {vA}</span>
                      {diff && <span style={{ color: '#58a6ff', marginLeft: 8 }}>→ v{compareB.version_number}: {vB}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div style={{ maxHeight: '50vh', overflowY: 'auto' }} role="list" aria-label="Version history list">
            {versionsLoading ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#555' }}>Loading versions…</div>
            ) : versions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#555' }}>No versions yet — edit and save to create v1</div>
            ) : versions.map((ver, i) => {
              const isA = compareA?.id === ver.id;
              const isB = compareB?.id === ver.id;
              const typeColors: Record<string, string> = { create: '#3fb950', edit: '#58a6ff', price_change: '#ffa600', status_change: '#bc8cff', stock_adjust: '#56d364', delete: '#f85149' };
              const typeColor = typeColors[ver.change_type] ?? '#8b949e';
              const d = new Date(ver.created_at);
              return (
                <div key={ver.id} role="listitem"
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px', borderBottom: '1px solid rgba(255,255,255,0.04)', background: isA || isB ? 'rgba(88,166,255,0.06)' : 'transparent' }}>
                  <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, background: `${typeColor}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: typeColor }}
                    aria-label={`Version ${ver.version_number}`}>
                    v{ver.version_number}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx)' }}>{ver.change_summary ?? 'Product updated'}</div>
                    <div style={{ fontSize: 10, color: 'var(--tx2)', marginTop: 2 }}>
                      <span style={{ background: `${typeColor}22`, color: typeColor, padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 700, marginRight: 6 }}>{ver.change_type}</span>
                      by {ver.changed_by} · {d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })} {d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {compareMode ? (
                      <>
                        <button onClick={() => setCompareA(isA ? null : ver)} aria-pressed={isA} aria-label={`Set version ${ver.version_number} as A for comparison`}
                          style={{ fontSize: 10, padding: '4px 10px', borderRadius: 4, border: `1px solid ${isA ? '#58a6ff' : 'var(--bd)'}`, color: isA ? '#58a6ff' : 'var(--tx2)', background: isA ? 'rgba(88,166,255,0.1)' : 'transparent', cursor: 'pointer' }}>
                          {isA ? '✓ A' : 'Set A'}
                        </button>
                        <button onClick={() => setCompareB(isB ? null : ver)} aria-pressed={isB} aria-label={`Set version ${ver.version_number} as B for comparison`}
                          style={{ fontSize: 10, padding: '4px 10px', borderRadius: 4, border: `1px solid ${isB ? '#ffa600' : 'var(--bd)'}`, color: isB ? '#ffa600' : 'var(--tx2)', background: isB ? 'rgba(255,166,0,0.1)' : 'transparent', cursor: 'pointer' }}>
                          {isB ? '✓ B' : 'Set B'}
                        </button>
                      </>
                    ) : (
                      i > 0 && (
                        <button onClick={() => rollbackToVersion(ver)} disabled={rollingBack}
                          aria-label={`Rollback to version ${ver.version_number}`}
                          aria-busy={rollingBack}
                          style={{ fontSize: 10, padding: '4px 10px', borderRadius: 4, border: '1px solid rgba(248,81,73,0.4)', color: '#f85149', background: 'rgba(248,81,73,0.08)', cursor: 'pointer', opacity: rollingBack ? 0.6 : 1 }}>
                          ↩ Rollback
                        </button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </AccessibleModal>
      )}

      {/* ── Product Add/Edit Modal ── */}
      {modal && (
        <AccessibleModal
          title={modal === 'add' ? '+ Add Product' : `Edit — ${(modal as Product).name}`}
          onClose={() => { setModal(null); setModalTab('basic'); setMrpError(''); }}
          fullscreen
        >
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Tab nav */}
            <div role="tablist" aria-label="Product form sections"
              style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--bd,#1a5c2a)', marginBottom: '18px', flexShrink: 0 }}>
              {[
                { id: 'basic'   as const, label: '📋 Basic Info' },
                { id: 'pricing' as const, label: '💰 Pricing & Variants' },
                { id: 'ai'      as const, label: '🤖 AI Content', badge: aiSaved ? '✓' : null },
              ].map(tab => (
                <button key={tab.id}
                  role="tab"
                  aria-selected={modalTab === tab.id}
                  aria-controls={`tabpanel-${tab.id}`}
                  id={`tab-${tab.id}`}
                  onClick={() => setModalTab(tab.id)}
                  className="px-4 py-2 text-[12px] font-bold transition flex items-center gap-1.5"
                  style={{ borderBottom: modalTab === tab.id ? '2px solid var(--accent,#1a5c2a)' : '2px solid transparent', marginBottom: '-2px', color: modalTab === tab.id ? 'var(--accent,#1a5c2a)' : 'var(--tx2,#6e9a75)', background: 'transparent' }}>
                  {tab.label}
                  {tab.badge && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: 'rgba(63,185,80,0.2)', color: '#3fb950' }}>{tab.badge}</span>}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: '4px' }}>
              {/* ── BASIC INFO TAB ── */}
              <div role="tabpanel" id="tabpanel-basic" aria-labelledby="tab-basic" hidden={modalTab !== 'basic'}>
              {modalTab === 'basic' && (
                <ErrorBoundary label="Basic Info">
                <div className="space-y-3">
                  <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 130px' }}>
                    <Field label="NAME *" htmlFor="prod-name">
                      <input id="prod-name" value={form.name} aria-required="true"
                        onChange={e => {
                          const name = e.target.value;
                          setForm(f => ({ ...f, name, slug: f.slug || slugify(name) }));
                        }}
                        className={inp} placeholder="Product name" />
                    </Field>
                    <Field label="STATUS" htmlFor="prod-status">
                      <select id="prod-status" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={inp}>
                        <option value="active">✅ Active</option>
                        <option value="draft">📝 Draft</option>
                        <option value="out_of_stock">⏸ Out of Stock</option>
                        <option value="review">🔍 Under Review</option>
                        <option value="discontinued">🚫 Discontinued</option>
                        <option value="blocked">🔒 Blocked</option>
                      </select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="SLUG" htmlFor="prod-slug"><input id="prod-slug" value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} className={inp} placeholder="auto from name" /></Field>
                    <Field label="VENDOR / SUPPLIER" htmlFor="prod-vendor">
                      <select id="prod-vendor" value={form.vendor_id || ''} onChange={e => setForm(f => ({ ...f, vendor_id: e.target.value }))} className={inp}>
                        <option value="">— None —</option>
                        {vendors.filter(v => v.status === 'active').map(v => (
                          <option key={v.id} value={String(v.id)}>{v.business_name} ({v.name})</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="EMOJI" htmlFor="prod-emoji"><input id="prod-emoji" value={form.emoji} onChange={e => setForm(f => ({ ...f, emoji: e.target.value }))} className={inp} placeholder="🍯" aria-label="Optional emoji" /></Field>
                    <Field label="UNIT LABEL" htmlFor="prod-unit"><input id="prod-unit" value={form.unit_label || ''} onChange={e => setForm(f => ({ ...f, unit_label: e.target.value }))} className={inp} placeholder="e.g. per 500g jar" /></Field>
                    <Field label="CATEGORY" htmlFor="prod-cat">
                      <select id="prod-cat" value={form.category_id || ''} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))} className={inp}
                        aria-required="true" aria-describedby={!form.category_id ? 'cat-warning' : undefined}
                        style={{ borderColor: !form.category_id ? '#f85149' : undefined }}>
                        <option value="">⚠️ Select category…</option>
                        {(() => {
                          const roots    = categories.filter(c => !c.parent_category_id);
                          const children = categories.filter(c => c.parent_category_id);
                          const result: React.ReactElement[] = [];
                          roots.forEach(root => {
                            result.push(<option key={root.id} value={String(root.id)}>📁 {root.name}</option>);
                            children.filter(c => String(c.parent_category_id) === String(root.id))
                              .forEach(child => result.push(<option key={child.id} value={String(child.id)}>　└ {child.name}</option>));
                          });
                          children.filter(c => !roots.find(r => String(r.id) === String(c.parent_category_id)))
                            .forEach(c => result.push(<option key={c.id} value={String(c.id)}>{c.name}</option>));
                          return result;
                        })()}
                      </select>
                      {!form.category_id && <div id="cat-warning" role="alert" className="mt-1 text-[11px] font-semibold" style={{ color: '#f85149' }}>Required — won&apos;t show in store</div>}
                    </Field>
                    <Field label="STATE *" htmlFor="prod-state">
                      <select id="prod-state" value={form.state_id || ''} onChange={e => setForm(f => ({ ...f, state_id: e.target.value }))} className={inp} aria-required="true">
                        <option value="">Select…</option>
                        {states.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                      </select>
                    </Field>
                  </div>
                  <Field label="HSN CODE" htmlFor="hsn-input">
                    <HsnSelector value={form.hsn_code || ''} onChange={v => setForm(f => ({ ...f, hsn_code: v }))} />
                  </Field>
                  {attrDefs.length > 0 && (
                    <fieldset style={{ borderRadius: 10, padding: 12, background: 'var(--bg,#0d1117)', border: '1px solid var(--bd)', margin: 0 }}>
                      <legend style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx2)', letterSpacing: '0.08em', padding: '0 6px' }}>🏷 PRODUCT ATTRIBUTES</legend>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                        {attrDefs.map(attr => (
                          <Field key={attr.id} label={attr.name.toUpperCase()} htmlFor={`attr-${attr.id}`}>
                            {attr.data_type === 'boolean' ? (
                              <select id={`attr-${attr.id}`} value={attrValues[attr.id] ?? ''} onChange={e => setAttrValues(v => ({ ...v, [attr.id]: e.target.value }))} className={inp}>
                                <option value="">— Not set —</option>
                                <option value="true">✅ Yes</option>
                                <option value="false">❌ No</option>
                              </select>
                            ) : attr.data_type === 'select' ? (
                              // FIX: 'select' was already live in the DB for Processing Type
                              // and Packaging Type but had no rendering branch at all — it
                              // silently fell through to the free-text input below. Options
                              // come from the new product_attributes.options column
                              // (013_product_attributes_select_types.sql).
                              <select id={`attr-${attr.id}`} value={attrValues[attr.id] ?? ''} onChange={e => setAttrValues(v => ({ ...v, [attr.id]: e.target.value }))} className={inp}>
                                <option value="">— Not set —</option>
                                {(attr.options ?? []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                              </select>
                            ) : attr.data_type === 'select_state' ? (
                              // Origin Region: sourced from the SAME live `states` list used
                              // by the "STATE *" field above, not a static copy — never goes
                              // out of sync if states are added/renamed.
                              <select id={`attr-${attr.id}`} value={attrValues[attr.id] ?? ''} onChange={e => setAttrValues(v => ({ ...v, [attr.id]: e.target.value }))} className={inp}>
                                <option value="">— Not set —</option>
                                {states.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                              </select>
                            ) : attr.data_type === 'duration' ? (
                              // Shelf Life: compound number + unit (Days/Months/Years).
                              <DurationInput
                                id={`attr-${attr.id}`}
                                value={attrValues[attr.id] ?? ''}
                                onChange={v => setAttrValues(vv => ({ ...vv, [attr.id]: v }))}
                                inputClassName={inp}
                              />
                            ) : (
                              <input id={`attr-${attr.id}`} type={attr.data_type === 'number' ? 'number' : 'text'} value={attrValues[attr.id] ?? ''} onChange={e => setAttrValues(v => ({ ...v, [attr.id]: e.target.value }))} className={inp} placeholder={`Enter ${attr.name.toLowerCase()}…`} />
                            )}
                          </Field>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  <Field label="SHORT DESCRIPTION" htmlFor="prod-short-desc">
                    <textarea id="prod-short-desc" value={form.short_description} onChange={e => setForm(f => ({ ...f, short_description: e.target.value }))} className={inp + ' resize-none'} style={{ height: '72px' }} placeholder="Shown in product cards…" />
                  </Field>
                  <Field label="LONG DESCRIPTION" htmlFor="prod-long-desc">
                    <textarea id="prod-long-desc" value={form.long_description} onChange={e => setForm(f => ({ ...f, long_description: e.target.value }))} className={inp + ' resize-none'} style={{ height: '96px' }} placeholder="Full description…" />
                  </Field>
                  {/* SEO Section — Audit finding #9 fix: products previously had
                      no way to set page-specific SEO title/description at all. */}
                  <fieldset style={{ borderRadius: 8, padding: 10, background: 'var(--bg,#0d1117)', border: '1px solid var(--bd)', margin: 0 }}>
                    <legend style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx2)', letterSpacing: '0.08em', padding: '0 6px' }}>
                      SEO
                    </legend>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                      <Field
                        label={<>SEO TITLE <CharCounter value={form.seo_title ?? ''} max={SEO_TITLE_MAX} /></>}
                        htmlFor="prod-seo-title">
                        <input id="prod-seo-title" value={form.seo_title ?? ''}
                          maxLength={SEO_TITLE_MAX}
                          onChange={e => setForm(f => ({ ...f, seo_title: e.target.value }))}
                          className={inp} placeholder="Shown in browser tab & Google (max 70 chars)"
                          aria-describedby="prod-seo-title-hint" />
                        <div id="prod-seo-title-hint" className="sr-only">Maximum {SEO_TITLE_MAX} characters. Google truncates longer titles.</div>
                      </Field>
                      <Field
                        label={<>SEO DESCRIPTION <CharCounter value={form.seo_description ?? ''} max={SEO_DESC_MAX} /></>}
                        htmlFor="prod-seo-desc">
                        <textarea id="prod-seo-desc" value={form.seo_description ?? ''}
                          maxLength={SEO_DESC_MAX}
                          onChange={e => setForm(f => ({ ...f, seo_description: e.target.value }))}
                          className={inp + ' h-14 resize-none'}
                          placeholder="Meta description for search engines (max 160 chars)"
                          aria-describedby="prod-seo-desc-hint" />
                        <div id="prod-seo-desc-hint" className="sr-only">Maximum {SEO_DESC_MAX} characters. Google truncates longer descriptions.</div>
                      </Field>
                    </div>
                  </fieldset>
                  <Field label="TAGS (comma separated)" htmlFor="prod-tags">
                    <input id="prod-tags" value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} className={inp} placeholder="himalayan, natural, raw…" />
                  </Field>
                  <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                    <legend className="block text-[10px] font-bold uppercase tracking-wider mb-2 text-[var(--tx2)]">BADGES</legend>
                    <div className="flex gap-2 flex-wrap">
                      {[
                        { key: 'badges_bestseller' as const, label: '🏆 Bestseller', color: 'var(--yellow)' },
                        { key: 'badges_organic'    as const, label: '🌿 Natural',    color: '#3fb950'       },
                        { key: 'badges_new'        as const, label: '✨ New',         color: 'var(--blue)'  },
                      ].map(b => (
                        <label key={b.key} className="flex items-center gap-1.5 cursor-pointer px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition"
                          style={{ background: form[b.key] ? `${b.color}22` : 'var(--bg,#0d1117)', border: `1px solid ${form[b.key] ? b.color : 'var(--bd,#1a5c2a)'}`, color: form[b.key] ? b.color : 'var(--tx2,#6e9a75)' }}>
                          <input type="checkbox" checked={form[b.key]} onChange={e => setForm(f => ({ ...f, [b.key]: e.target.checked }))} className="accent-green-600" aria-label={b.label} />
                          {b.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>
                </ErrorBoundary>
              )}
              </div>

              {/* ── PRICING & VARIANTS TAB ── */}
              <div role="tabpanel" id="tabpanel-pricing" aria-labelledby="tab-pricing" hidden={modalTab !== 'pricing'}>
              {modalTab === 'pricing' && (
                <ErrorBoundary label="Pricing & Variants">
                <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
                  {/* LEFT: Pricing */}
                  <div className="space-y-3" style={{ flex: 1, minWidth: 0 }}>
                    <div className="text-[10px] font-bold uppercase tracking-widest mb-3 pb-1" style={{ color: 'var(--accent,#1a5c2a)', borderBottom: '1px solid var(--bd,#1a5c2a)' }}>💰 Pricing</div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="GST RATE" htmlFor="prod-gst">
                        <select id="prod-gst" value={form.gst_rate} onChange={e => {
                          const rate = parseFloat(e.target.value) || 0;
                          const sell_p = toPaise(form.selling_price || 0);
                          const base_p = removeGst(sell_p, rate);
                          setForm(f => ({ ...f, gst_rate: e.target.value, price: String(toRupees(base_p)) }));
                        }} className={inp}>
                          {gstRates.map(r => <option key={r.value} value={r.value}>{r.value}%</option>)}
                        </select>
                      </Field>
                      <Field label="COST PRICE ₹ (landed cost)" htmlFor="prod-cost">
                        <input id="prod-cost" type="number" value={form.cost_price} onChange={e => setForm(f => ({ ...f, cost_price: e.target.value }))} className={inp} placeholder="What you paid" aria-describedby="cost-hint" />
                        {/* A11Y-7 FIX: aria-describedby="cost-hint" pointed at an ID that
                            didn't exist anywhere in the document — a broken ARIA
                            reference that silently provided no information to screen
                            reader users (compare to the working "base-hint" pattern
                            a few fields below, which this now matches). */}
                        <span id="cost-hint" className="sr-only">Used to calculate gross margin. Not shown to customers.</span>
                      </Field>
                    </div>
                    {/* Live GST breakdown */}
                    <div className="rounded-xl p-3" style={{ background: 'var(--bg,#0d1117)', border: '2px solid var(--accent,#1a5c2a)' }}
                      role="region" aria-label="Live GST breakdown">
                      <div className="text-[10px] font-bold text-yellow-400 mb-2 tracking-wider">⚡ LIVE GST BREAKDOWN</div>
                      <div className="flex items-center justify-center gap-2 mb-2 text-center">
                        <div><div className="text-[9px] text-[var(--tx2)]">Base (excl. GST)</div><div className="text-[18px] font-bold text-[var(--tx)]" aria-label={`Base price: ₹${gst.base}`}>₹{gst.base}</div></div>
                        <div aria-hidden="true" className="text-[var(--tx2)]">+</div>
                        <div><div className="text-[9px] text-[var(--tx2)]">GST @{form.gst_rate}%</div><div className="text-[18px] font-bold text-orange-400" aria-label={`GST amount: ₹${gst.gstAmt}`}>₹{gst.gstAmt}</div></div>
                        <div aria-hidden="true" className="text-[var(--tx2)]">=</div>
                        <div><div className="text-[9px] text-[var(--tx2)]">Customer Pays</div><div className="text-[18px] font-bold text-green-400" aria-label={`Customer pays: ₹${gst.selling}`}>₹{gst.selling}</div></div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {gst.isInterstate ? (
                          <div className="col-span-2 rounded p-2 text-center" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(239,159,39,0.4)' }}
                            aria-label={`IGST inter-state: ₹${gst.igst}`}>
                            <div className="text-[9px] text-orange-400 font-bold">IGST (inter-state supply)</div>
                            <div className="text-[14px] font-bold text-[var(--tx)]">₹{gst.igst}</div>
                            <div className="text-[9px] text-[var(--tx2)] mt-0.5">CGST + SGST do not apply for inter-state</div>
                          </div>
                        ) : (
                          <>
                            <div className="rounded p-2 text-center" style={{ background: 'rgba(0,0,0,0.3)' }} aria-label={`CGST intrastate: ₹${gst.cgst}`}>
                              <div className="text-[9px] text-[var(--tx2)]">CGST (intrastate)</div>
                              <div className="text-[14px] font-bold text-[var(--tx)]">₹{gst.cgst}</div>
                            </div>
                            <div className="rounded p-2 text-center" style={{ background: 'rgba(0,0,0,0.3)' }} aria-label={`SGST intrastate: ₹${gst.sgst}`}>
                              <div className="text-[9px] text-[var(--tx2)]">SGST (intrastate)</div>
                              <div className="text-[14px] font-bold text-[var(--tx)]">₹{gst.sgst}</div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    <Field label="SELLING PRICE ₹ (incl. GST) *" htmlFor="prod-sell">
                      <input id="prod-sell" type="number" value={form.selling_price} aria-required="true"
                        onChange={e => handleSellingPriceChange(e.target.value)}
                        className={inp} placeholder="0.00"
                        style={{ color: '#3fb950' }} />
                      {psySell && psySell !== Math.round(sellingF) && (
                        <button type="button" onClick={() => handleSellingPriceChange(String(psySell))}
                          aria-label={`Apply psychological price ₹${psySell}`}
                          className="mt-1 text-[10px] font-semibold px-2 py-0.5 rounded"
                          style={{ background: 'rgba(88,166,255,0.1)', color: 'var(--blue)', border: '1px solid rgba(88,166,255,0.25)' }}>
                          💡 Snap to ₹{psySell} (psychological price)
                        </button>
                      )}
                    </Field>
                    <Field label="BASE PRICE ₹ (excl. GST — auto-computed)" htmlFor="prod-base">
                      <input id="prod-base" type="number" value={form.price} readOnly className={inp}
                        aria-readonly="true" aria-describedby="base-hint"
                        style={{ color: 'var(--tx2)', opacity: 0.7, cursor: 'not-allowed' }} />
                      <span id="base-hint" className="sr-only">Automatically computed from selling price and GST rate</span>
                    </Field>
                    <Field label="LEGAL MRP ₹ (printed on package)" htmlFor="prod-mrp">
                      <input id="prod-mrp" type="number" value={form.mrp}
                        aria-describedby={mrpError ? 'mrp-error' : 'mrp-hint'}
                        // A11Y-6 FIX (WCAG 3.3.1 Error Identification / 4.1.2):
                        // aria-describedby alone announces the error text when the
                        // field is focused, but doesn't mark the field itself as
                        // invalid — screen readers that announce field validity
                        // (e.g. "invalid entry") on focus had nothing to read here.
                        aria-invalid={mrpError ? 'true' : 'false'}
                        onChange={e => {
                          const val = e.target.value;
                          const mrp = parseFloat(val) || 0;
                          const selling = parseFloat(form.selling_price as string) || 0;
                          setMrpError(mrp > 0 && mrp < selling ? `MRP (₹${mrp}) cannot be less than Selling Price (₹${selling.toFixed(0)})` : '');
                          setForm(f => ({ ...f, mrp: val }));
                        }}
                        className={inp} placeholder="Leave blank = same as selling price"
                        style={{ borderColor: mrpError ? '#f85149' : undefined }} />
                      {mrpError && <div id="mrp-error" role="alert" className="mt-1 text-[11px] font-semibold" style={{ color: '#f85149' }}>⚠️ {mrpError}</div>}
                      {!mrpError && form.mrp && parseFloat(form.mrp) > sellingF && (
                        <div className="mt-1 text-[11px] font-semibold" style={{ color: '#3fb950' }}>
                          ✓ {Math.round((1 - sellingF / parseFloat(form.mrp)) * 100)}% discount shown to customer
                        </div>
                      )}
                      {/* A11Y-7 FIX: aria-describedby="mrp-hint" (set on #prod-mrp above
                          when there's no error) pointed at an ID that didn't exist —
                          a broken ARIA reference. Added the missing sr-only hint,
                          matching the working "base-hint"/"cost-hint" pattern. */}
                      {!mrpError && <span id="mrp-hint" className="sr-only">Maximum Retail Price printed on the package. Leave blank to use the selling price.</span>}
                    </Field>
                    <Field label="COMPARE AT PRICE ₹ (strikethrough on site)" htmlFor="prod-compare">
                      <input id="prod-compare" type="number" value={form.compare_at_price} onChange={e => setForm(f => ({ ...f, compare_at_price: e.target.value }))} className={inp} placeholder="e.g. was ₹599, now ₹399" />
                    </Field>
                    {liveMargin !== null && liveMeta && (
                      <div className="rounded-xl p-3" role="status" aria-label={`Gross margin: ${liveMargin.toFixed(1)}%`}
                        style={{ background: liveMeta.bg, border: `1px solid ${liveMeta.color}33` }}>
                        <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: liveMeta.color }}>📊 Gross Margin</div>
                        <div className="text-[22px] font-bold" style={{ color: liveMeta.color }}>{liveMargin.toFixed(1)}%</div>
                        <div className="text-[11px] mt-1" style={{ color: liveMeta.color }}>{liveMeta.label}</div>
                      </div>
                    )}
                    <Field label="IMAGE URL" htmlFor="prod-img-url">
                      <div className="flex gap-2">
                        <input id="prod-img-url" value={form.image_url} onChange={e => setForm(f => ({ ...f, image_url: e.target.value }))} className={inp} placeholder="https://…" />
                        <button type="button" onClick={openImgModal} aria-label="Open media manager to upload images" className="flex-shrink-0 px-3 py-2 rounded-lg text-[11px] font-bold text-[var(--tx)]" style={{ background: 'var(--accent,#1a5c2a)' }}>📤</button>
                      </div>
                    </Field>
                    {/* SECURITY FIX: Only render preview if URL passes allow-list check */}
                    {isSafeImageUrl(form.image_url) && (
                      <img src={form.image_url} alt="Product preview" className="w-full rounded-xl object-cover" style={{ height: '160px', border: '1px solid var(--bd,#1a5c2a)' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    )}
                  </div>

                  {/* RIGHT: Variants */}
                  <div className="space-y-3" style={{ flex: 1, minWidth: 0 }}>
                    <div className="text-[10px] font-bold uppercase tracking-widest mb-3 pb-1" style={{ color: 'var(--accent,#1a5c2a)', borderBottom: '1px solid var(--bd,#1a5c2a)' }}>📦 Variants</div>
                    <div className="flex gap-2 mb-2 flex-wrap" role="toolbar" aria-label="Variant tools">
                      <button type="button" onClick={() => setAutoPanel(p => !p)}
                        aria-expanded={autoPanel} aria-controls="auto-panel"
                        className="text-[11px] px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5"
                        style={{ background: autoPanel ? 'rgba(210,153,34,0.25)' : 'var(--yellow-bg)', border: '1px solid rgba(210,153,34,0.4)', color: 'var(--yellow)' }}>
                        ⚡ Auto-generate {autoPanel ? '▲' : '▼'}
                      </button>
                      <button type="button" onClick={addVariant}
                        aria-label="Add a new variant manually"
                        className="text-[11px] px-3 py-1.5 rounded-lg font-bold"
                        style={{ background: 'var(--bg,#0d1117)', border: '1px solid var(--bd,#1a5c2a)', color: 'var(--accent,#1a5c2a)' }}>
                        + Add Variant
                      </button>
                    </div>
                    {autoPanel && (
                      <div id="auto-panel" className="rounded-xl p-3 space-y-3" style={{ background: 'rgba(210,153,34,0.06)', border: '1px solid rgba(210,153,34,0.25)' }}
                        role="region" aria-label="Auto-generate variants panel">
                        <div className="text-[11px] font-bold text-yellow-400">⚡ Auto-generate variants</div>
                        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                          <legend className="text-[10px] font-bold text-[var(--tx2)] uppercase mb-1.5">Pricing Strategy</legend>
                          <div className="grid grid-cols-3 gap-1.5">
                            {[
                              { v: 'linear',           l: '📏 Linear'       },
                              { v: 'margin-protected', l: '🛡️ Margin-safe'  },
                              { v: 'psychological',    l: '🧠 Psychological' },
                            ].map(opt => (
                              <button key={opt.v} type="button" onClick={() => setVariantStrategy(opt.v)}
                                aria-pressed={variantStrategy === opt.v}
                                className="py-1.5 rounded-lg text-[10px] font-bold transition"
                                style={{ background: variantStrategy === opt.v ? 'rgba(210,153,34,0.25)' : 'transparent', border: `1px solid ${variantStrategy === opt.v ? 'rgba(210,153,34,0.5)' : 'rgba(255,255,255,0.08)'}`, color: variantStrategy === opt.v ? '#d29922' : 'var(--tx2)' }}>
                                {opt.l}
                              </button>
                            ))}
                          </div>
                        </fieldset>
                        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                          <legend className="sr-only">Unit type</legend>
                          <div className="flex gap-2">
                            {[{ v: 'weight', l: '⚖️ Weight (g/kg)' }, { v: 'liquid', l: '💧 Liquid (ml/L)' }].map(opt => (
                              <button key={opt.v} type="button"
                                aria-pressed={avUnitType === opt.v}
                                onClick={() => { setAvUnitType(opt.v); setAvSelectedSizes([]); setAvBaseUnit(opt.v === 'liquid' ? '250ml' : '250g'); }}
                                className="flex-1 py-1.5 rounded-lg text-[11px] font-bold transition"
                                style={{ background: avUnitType === opt.v ? 'color-mix(in srgb, var(--yellow-bg) 60%, transparent)' : 'transparent', border: `1px solid ${avUnitType === opt.v ? 'rgba(210,153,34,0.5)' : 'rgba(255,255,255,0.08)'}`, color: avUnitType === opt.v ? '#d29922' : 'var(--tx2)' }}>
                                {opt.l}
                              </button>
                            ))}
                          </div>
                        </fieldset>
                        <div className="grid grid-cols-2 gap-2">
                          <Field label="Base Unit" htmlFor="av-base-unit">
                            <select id="av-base-unit" value={avBaseUnit} onChange={e => setAvBaseUnit(e.target.value)} className={inp}>
                              {ALL_SIZES.map(u => <option key={u}>{u}</option>)}
                            </select>
                          </Field>
                          <Field label={`Price for ${avBaseUnit} ₹`} htmlFor="av-base-price">
                            <input id="av-base-price" type="number" value={avBasePrice} onChange={e => setAvBasePrice(e.target.value)} className={inp} placeholder={form.selling_price as string || '0'} />
                          </Field>
                        </div>
                        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                          <legend className="text-[10px] font-bold text-[var(--tx2)] uppercase mb-1.5">Select Sizes</legend>
                          <div className="grid grid-cols-3 gap-1.5">
                            {ALL_SIZES.map(sz => {
                              const checked        = avSelectedSizes.includes(sz);
                              const alreadyExists  = variants.some(v => v.variant_value?.toLowerCase().trim() === sz.toLowerCase().trim());
                              const bp             = parseFloat(avBasePrice) || parseFloat(form.selling_price as string) || 0;
                              const gst            = Number(form.gst_rate) || 5;
                              const previewArr     = bp > 0 ? calcVariantPrices(bp, avBaseUnit, [sz], gst, variantStrategy) : null;
                              const previewPrice   = previewArr?.[0]?.price ?? null;
                              return (
                                <label key={sz} className="flex flex-col rounded-lg px-2 py-1.5 cursor-pointer select-none"
                                  aria-label={`${sz}${alreadyExists ? ' (already exists)' : ''}${previewPrice ? `, estimated ₹${previewPrice}` : ''}`}
                                  style={{ background: checked ? 'rgba(210,153,34,0.18)' : 'transparent', border: `1px solid ${checked ? 'rgba(210,153,34,0.5)' : 'rgba(255,255,255,0.08)'}`, opacity: alreadyExists ? 0.4 : 1 }}>
                                  <div className="flex items-center gap-1.5">
                                    <input type="checkbox" checked={checked} disabled={alreadyExists}
                                      onChange={() => setAvSelectedSizes(s => checked ? s.filter(x => x !== sz) : [...s, sz])}
                                      className="accent-yellow-500 w-3 h-3" />
                                    <span className="text-[11px] font-bold" style={{ color: checked ? '#d29922' : 'var(--tx2)' }}>{sz}</span>
                                    {alreadyExists && <span aria-hidden="true" className="text-[9px] text-[var(--tx2)] ml-auto">✓</span>}
                                  </div>
                                  {previewPrice && !alreadyExists && <span aria-hidden="true" className="text-[10px] font-bold text-yellow-500 ml-4">₹{previewPrice}</span>}
                                </label>
                              );
                            })}
                          </div>
                          <div className="flex gap-2 mt-1.5">
                            <button type="button" onClick={() => setAvSelectedSizes(ALL_SIZES.filter(sz => !variants.some(v => v.variant_value?.toLowerCase().trim() === sz.toLowerCase().trim())))} className="text-[10px] text-yellow-500 underline" aria-label="Select all available sizes">Select All</button>
                            <button type="button" onClick={() => setAvSelectedSizes([])} className="text-[10px] text-[var(--tx2)] underline" aria-label="Clear size selection">Clear</button>
                          </div>
                        </fieldset>
                        <div className="flex gap-2">
                          <button type="button" onClick={autoGenerate} disabled={!avSelectedSizes.length}
                            aria-label={`Generate ${avSelectedSizes.length} variant${avSelectedSizes.length !== 1 ? 's' : ''}`}
                            className="flex-1 py-2 rounded-lg text-[12px] font-bold text-[var(--tx)] disabled:opacity-40"
                            style={{ background: 'var(--yellow)' }}>
                            ⚡ Generate {avSelectedSizes.length} variant{avSelectedSizes.length !== 1 ? 's' : ''} →
                          </button>
                          <button type="button" onClick={() => setAutoPanel(false)} aria-label="Cancel auto-generate" className="px-4 py-2 rounded-lg text-[11px] text-[var(--tx2)] border border-[var(--bd)]">Cancel</button>
                        </div>
                      </div>
                    )}
                    {variants.length === 0 && !autoPanel && (
                      <div className="rounded-xl p-4 text-center" style={{ background: 'var(--bg,#0d1117)', border: '1px dashed var(--bd,#1a5c2a)' }}>
                        <div className="text-[12px] text-[var(--tx2)] mb-1">No variants yet</div>
                        <div className="text-[10px] text-[var(--tx2)]">Add variants for multiple sizes (250g, 500g, 1kg etc.)</div>
                      </div>
                    )}
                    <div className="space-y-2" role="list" aria-label="Product variants">
                      {variants.map((v, i) => (
                        <div key={i} className="rounded-xl p-3 space-y-2" style={{ background: 'var(--bg,#0d1117)', border: '1px solid var(--bd,#1a5c2a)' }} role="listitem" aria-label={`Variant ${i + 1}${v.variant_value ? `: ${v.variant_value}` : ''}`}>
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] font-bold text-[var(--tx2)] uppercase">Variant #{i + 1}</div>
                            <button onClick={() => removeVariant(i)} aria-label={`Remove variant ${i + 1}${v.variant_value ? ` (${v.variant_value})` : ''}`} className="w-6 h-6 rounded flex items-center justify-center text-[var(--tx)] text-[11px]" style={{ background: '#e74c3c' }}>✕</button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Field label="Type" htmlFor={`var-type-${i}`}>
                              <select id={`var-type-${i}`} value={v.variant_type || 'weight'} onChange={e => updateVariant(i, 'variant_type', e.target.value)} className={inp} style={{ padding: '6px 8px' }}>
                                {['weight', 'volume', 'pack_size', 'grade'].map(t => <option key={t}>{t}</option>)}
                              </select>
                            </Field>
                            <Field label="Value" htmlFor={`var-val-${i}`}>
                              <input id={`var-val-${i}`} value={v.variant_value || ''} onChange={e => updateVariant(i, 'variant_value', e.target.value)} placeholder="e.g. 250g" className={inp} style={{ padding: '6px 8px' }} aria-label={`Variant ${i + 1} value, e.g. 250g`} />
                            </Field>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Field label="Sell ₹ (incl GST)" htmlFor={`var-price-${i}`}>
                              <input id={`var-price-${i}`} type="number" value={v.price} onChange={e => updateVariant(i, 'price', e.target.value)} className={inp} style={{ padding: '6px 8px' }} />
                            </Field>
                            <Field label="Status" htmlFor={`var-status-${i}`}>
                              <select id={`var-status-${i}`} value={v.is_active !== false ? 'true' : 'false'} onChange={e => updateVariant(i, 'is_active', e.target.value === 'true')} className={inp} style={{ padding: '6px 8px' }}>
                                <option value="true">✓ Active</option>
                                <option value="false">✗ Off</option>
                              </select>
                            </Field>
                          </div>
                          <Field label={(!v.initial_stock || parseInt(v.initial_stock, 10) <= 0) ? 'Initial Stock *' : 'Initial Stock'} htmlFor={`var-stock-${i}`}>
                            <input id={`var-stock-${i}`} type="number" value={v.initial_stock}
                              aria-required="true"
                              aria-describedby={(!v.initial_stock || parseInt(v.initial_stock, 10) <= 0) ? `stock-err-${i}` : undefined}
                              onChange={e => updateVariant(i, 'initial_stock', e.target.value)}
                              className={inp} style={{ padding: '5px 8px', borderColor: (!v.initial_stock || parseInt(v.initial_stock, 10) <= 0) ? 'rgba(248,81,73,0.5)' : undefined }}
                              placeholder="Total purchased *" />
                            {(!v.initial_stock || parseInt(v.initial_stock, 10) <= 0) && (
                              <span id={`stock-err-${i}`} role="alert" className="sr-only">Initial stock is required for inventory tracking</span>
                            )}
                          </Field>

                          {v._id && (
                            <div className="rounded-lg p-2 space-y-1.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed var(--bd,#1a5c2a)' }}>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--tx2)]">
                                  Adjust Live Stock
                                </span>
                                <span className="text-[10px] text-[var(--tx2)]">
                                  Current: <strong style={{ color: 'var(--tx)' }}>{v.available_stock ?? 0}</strong>
                                </span>
                              </div>
                              <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
                                <input
                                  type="number"
                                  aria-label={`Adjust stock amount for variant ${i + 1}`}
                                  placeholder="±qty"
                                  value={stockAdjustDelta[i] ?? ''}
                                  onChange={e => setStockAdjustDelta(prev => ({ ...prev, [i]: e.target.value }))}
                                  className={inp}
                                  style={{ padding: '5px 8px' }}
                                  disabled={stockAdjustBusy === i}
                                />
                                <select
                                  aria-label={`Adjustment reason for variant ${i + 1}`}
                                  value={stockAdjustReason[i] ?? 'manual'}
                                  onChange={e => setStockAdjustReason(prev => ({ ...prev, [i]: e.target.value }))}
                                  className={inp}
                                  style={{ padding: '5px 8px' }}
                                  disabled={stockAdjustBusy === i}
                                >
                                  <option value="manual">Manual</option>
                                  <option value="adjustment">Correction</option>
                                  <option value="return">Return</option>
                                </select>
                                <button
                                  onClick={() => applyStockAdjust(i)}
                                  disabled={stockAdjustBusy === i}
                                  className="rounded text-[11px] font-semibold px-3"
                                  style={{ background: 'var(--accent)', color: '#fff', opacity: stockAdjustBusy === i ? 0.6 : 1 }}
                                >
                                  {stockAdjustBusy === i ? '...' : 'Apply'}
                                </button>
                              </div>
                              <div className="text-[9px] text-[var(--tx2)]">
                                Applies immediately — separate from "Save Product" below.
                              </div>
                            </div>
                          )}

                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-wider mb-1 text-[var(--tx2)]">
                              SKU {v._id && v.sku ? '🔒' : ''}
                            </div>
                            <div className={inp} title={v._id && v.sku ? 'Immutable — SKU cannot change after creation' : 'Will be generated on save'}
                              aria-label={`SKU: ${v.sku || 'will be generated on save'}`}
                              style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11, color: v._id && v.sku ? 'var(--blue)' : '#aaa', userSelect: 'all', cursor: 'default' }}>
                              {v.sku || generateSku(form.name, v.variant_value, (catMap[String(form.category_id)] ?? '')) || '—'}
                            </div>
                          </div>
                          {v._base && <div className="text-[10px] text-[var(--tx2)]" aria-label={`Base price excluding GST: ₹${v._base}`}>Base excl. GST: ₹{v._base}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                </ErrorBoundary>
              )}
              </div>

              {/* ── AI CONTENT TAB ── */}
              <div role="tabpanel" id="tabpanel-ai" aria-labelledby="tab-ai" hidden={modalTab !== 'ai'}>
              {modalTab === 'ai' && (
                <ErrorBoundary label="AI Content">
                <div className="space-y-3 max-w-xl">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--purple)' }}>🤖 AI Content</div>
                    {aiSaved && !aiPreview && <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(63,185,80,0.12)', border: '1px solid rgba(63,185,80,0.3)', color: '#3fb950' }}>✓ Content saved</span>}
                  </div>
                  {aiError && <div role="alert" className="text-[11px] mb-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.2)', color: '#f85149' }}>⚠ {aiError}</div>}
                  {!aiPreview && (
                    <button onClick={handleGenerateAI} disabled={aiLoadingHook || modal === 'add'}
                      aria-busy={aiLoadingHook}
                      aria-label={aiSaved ? 'Regenerate AI content' : 'Generate AI content'}
                      className="w-full rounded-xl font-bold transition mb-2 flex items-center justify-center gap-2"
                      style={{ padding: '14px 20px', fontSize: '14px', background: aiLoadingHook ? 'rgba(137,87,229,0.1)' : 'linear-gradient(135deg, rgba(137,87,229,0.25) 0%, rgba(99,60,180,0.35) 100%)', border: '2px solid rgba(137,87,229,0.6)', color: '#c0a0ff', cursor: modal === 'add' ? 'not-allowed' : 'pointer', opacity: modal === 'add' ? 0.4 : 1 }}>
                      {aiLoadingHook ? 'Generating content…' : aiSaved ? '🔄 Regenerate with Claude Haiku' : '✨ Generate AI Content with Claude Haiku'}
                    </button>
                  )}
                  {aiPreview && (
                    <div className="rounded-lg p-3 mb-2 text-[11px] space-y-2" style={{ background: 'color-mix(in srgb, var(--purple-bg) 40%, transparent)', border: '1px solid var(--purple-bg)' }}
                      role="region" aria-label="AI content preview — not yet saved">
                      {aiPreview.description && <div><div style={{ color: 'var(--purple)', fontWeight: 700, fontSize: 10 }}>📄 Description</div><div style={{ color: 'var(--tx)', lineHeight: 1.5 }}>{aiPreview.description}</div></div>}
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => handleSaveAI((modal as Product).id)} aria-label="Save AI content to database" className="flex-1 py-1.5 rounded-lg text-[11px] font-bold" style={{ background: 'rgba(63,185,80,0.15)', border: '1px solid rgba(63,185,80,0.35)', color: '#3fb950' }}>✓ Save & Go Live</button>
                        <button onClick={handleGenerateAI} disabled={aiLoadingHook} aria-label="Retry AI generation" className="py-1.5 px-3 rounded-lg text-[11px] font-bold" style={{ background: 'var(--purple-bg)', border: '1px solid rgba(137,87,229,0.3)', color: 'var(--purple)' }}>🔄 Retry</button>
                        <button onClick={handleDiscardAI} aria-label="Discard AI preview" className="py-1.5 px-3 rounded-lg text-[11px] font-bold" style={{ background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.2)', color: '#f85149' }}>✕</button>
                      </div>
                    </div>
                  )}
                  {aiSaved && !aiPreview && (
                    <div className="rounded-lg p-2.5 text-[10px]" style={{ background: 'rgba(63,185,80,0.05)', border: '1px solid rgba(63,185,80,0.15)' }} role="region" aria-label="Saved AI content">
                      <div style={{ color: '#3fb950', fontWeight: 700, marginBottom: 4 }}>✓ Live on customer site</div>
                      <div style={{ color: 'var(--tx2)', lineHeight: 1.5, marginBottom: 4 }} className="line-clamp-2">{aiSaved.description}</div>
                      <div className="flex flex-wrap gap-x-3" style={{ color: 'var(--tx2)', fontSize: 9 }}>
                        <span>💚 {aiSaved.benefits?.length ?? 0} benefits</span>
                        <span>🍽️ {aiSaved.how_to_use?.length ?? 0} steps</span>
                        <span>📦 {aiSaved.storage_tips?.length ?? 0} tips</span>
                      </div>
                    </div>
                  )}
                  {modal === 'add' && <div className="text-[10px] text-center mt-1" style={{ color: 'var(--tx2)' }}>Save product first, then generate AI content</div>}
                </div>
                </ErrorBoundary>
              )}
              </div>
            </div>

            {/* Save bar */}
            <div className="flex gap-3 mt-4 pt-4 flex-shrink-0" style={{ borderTop: '1px solid var(--bd,#1a5c2a)' }}>
              <button onClick={save} disabled={saving || liveHealth === 'block'}
                aria-busy={saving}
                aria-disabled={liveHealth === 'block'}
                className="flex-1 py-2.5 rounded-lg text-[13px] font-bold text-[var(--tx)] transition"
                style={{ background: saving || liveHealth === 'block' ? '#333' : 'var(--accent,#1a5c2a)', opacity: liveHealth === 'block' ? 0.6 : 1 }}>
                {saving ? 'Saving…' : liveHealth === 'block' ? '❌ Fix margin before saving' : modal === 'add' ? '+ Add Product' : '💾 Save Product'}
              </button>
              <button onClick={() => { setModal(null); setMrpError(''); }}
                aria-label="Cancel and close product form"
                className="px-6 py-2.5 rounded-lg text-[13px] text-[var(--tx2)] border border-[var(--bd)] hover:border-gray-500 transition">
                Cancel
              </button>
            </div>
          </div>
        </AccessibleModal>
      )}

      {/* ── Toolbar ── */}
      <div role="toolbar" aria-label="Product management tools" className="flex items-center gap-2 flex-wrap">
        <label htmlFor="prod-search" className="sr-only">Search products</label>
        <input id="prod-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…"
          aria-label="Search products by name" aria-controls="products-table"
          className="rounded-lg px-3 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] flex-[2] min-w-0"
          style={{ background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#1a5c2a)', color: 'var(--tx,#fff)', height: 30 }} />
        <label htmlFor="filter-cat" className="sr-only">Filter by category</label>
        <select id="filter-cat" value={filterCat} onChange={e => setFilterCat(e.target.value)} aria-label="Filter by category"
          className="rounded-lg px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] flex-[1.2] min-w-0"
          style={{ background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#1a5c2a)', color: 'var(--tx,#fff)', height: 30 }}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
        </select>
        <label htmlFor="filter-size" className="sr-only">Filter by size</label>
        <select id="filter-size" value={filterSize} onChange={e => setFilterSize(e.target.value)} aria-label="Filter by variant size"
          className="rounded-lg px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] flex-[1.2] min-w-0"
          style={{ background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#1a5c2a)', color: 'var(--tx,#fff)', height: 30 }}>
          <option value="">All Sizes</option>
          {allSizes.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <label htmlFor="filter-stock" className="sr-only">Filter by stock status</label>
        <select id="filter-stock" value={filterStock} onChange={e => setFilterStock(e.target.value)} aria-label="Filter by stock status"
          className="rounded-lg px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] flex-[1.2] min-w-0"
          style={{ background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#1a5c2a)', color: 'var(--tx,#fff)', height: 30 }}>
          <option value="">All Status</option>
          <option value="out">Out of stock</option>
          <option value="low">Low (≤5)</option>
          <option value="ok">Good (&gt;10)</option>
        </select>
        <span className="text-[11px] whitespace-nowrap px-1" style={{ color: 'var(--tx2,#6e9a75)' }} aria-live="polite">
          {totalVariants} variant{totalVariants !== 1 ? 's' : ''}
        </span>
        {hasFilter && (
          <button onClick={() => { setSearch(''); setFilterCat(''); setFilterSize(''); setFilterStock(''); }}
            aria-label="Clear all filters"
            className="text-[11px] px-3 py-1 rounded-lg whitespace-nowrap"
            style={{ color: '#f85149', border: '1px solid rgba(248,81,73,0.3)', background: 'transparent', height: 30 }}>
            ✕ Clear
          </button>
        )}
        <button onClick={openAdd} aria-label="Add new product"
          className="px-4 py-2 rounded-lg text-[12px] font-bold text-[var(--tx)] whitespace-nowrap"
          style={{ background: 'var(--accent,#1a5c2a)', height: 30 }}>
          + Add Product
        </button>
        <button onClick={() => { setShowArchived(a => !a); setPage(0); setSelected(new Set()); }}
          aria-pressed={showArchived} aria-label={showArchived ? 'Exit archived view' : 'Show archived products'}
          className="px-3 py-1 rounded-lg text-[12px] font-semibold whitespace-nowrap"
          style={{ background: showArchived ? 'rgba(248,81,73,0.15)' : 'rgba(139,148,158,0.1)', border: showArchived ? '1px solid rgba(248,81,73,0.4)' : '1px solid var(--bd)', color: showArchived ? '#f85149' : 'var(--tx2)', height: 30 }}>
          {showArchived ? '🗄 Viewing Archived' : '🗄 Show Archived'}
        </button>
        <button onClick={exportCSV} aria-label="Export current page products as CSV"
          className="px-3 py-1 rounded-lg text-[12px] font-semibold whitespace-nowrap"
          style={{ background: 'rgba(88,166,255,0.12)', border: '1px solid rgba(88,166,255,0.3)', color: '#58a6ff', height: 30 }}>
          ⬇ Export Page CSV
        </button>
      </div>

      {/* Archived banner */}
      {showArchived && (
        <div role="status" style={{ padding: '10px 16px', borderRadius: 8, background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12, color: '#f85149', fontWeight: 600 }}>🗄 Viewing Archived Products — hidden from store</div>
        </div>
      )}

      {/* Bulk action toolbar */}
      {selected.size > 0 && (
        <div role="toolbar" aria-label={`Bulk actions for ${selected.size} selected products`}
          className="flex items-center gap-2 flex-wrap rounded-lg px-4 py-2"
          style={{ background: 'rgba(88,166,255,0.08)', border: '1px solid rgba(88,166,255,0.25)' }}>
          <span className="text-[12px] font-bold" style={{ color: '#58a6ff' }} aria-live="polite">{selected.size} selected</span>
          {[
            { label: '✅ Set Active',    status: 'active',        color: '#3fb950', bg: 'rgba(63,185,80,0.15)',   border: 'rgba(63,185,80,0.4)'   },
            { label: '⏸ Out of Stock', status: 'out_of_stock',  color: '#8b949e', bg: 'rgba(139,148,158,0.15)', border: 'rgba(139,148,158,0.4)' },
            { label: '🚫 Discontinue', status: 'discontinued',  color: '#ffa600', bg: 'rgba(255,166,0,0.15)',   border: 'rgba(255,166,0,0.4)'   },
            { label: '📝 Set Draft',    status: 'draft',         color: '#bc8cff', bg: 'rgba(188,140,255,0.15)', border: 'rgba(188,140,255,0.4)' },
          ].map(b => (
            <button key={b.status} onClick={() => bulkStatusChange(b.status)} disabled={bulkLoading}
              aria-label={`${b.label} for ${selected.size} products`}
              className="px-3 py-1 rounded text-[11px] font-bold"
              style={{ background: b.bg, border: `1px solid ${b.border}`, color: b.color, cursor: 'pointer' }}>
              {b.label}
            </button>
          ))}
          <button onClick={bulkArchive} disabled={bulkLoading} aria-label={`Archive ${selected.size} selected products`}
            className="px-3 py-1 rounded text-[11px] font-bold"
            style={{ background: 'rgba(248,81,73,0.15)', border: '1px solid rgba(248,81,73,0.4)', color: '#f85149', cursor: 'pointer' }}>
            🗄 Archive
          </button>
          {bulkLoading && <span className="text-[11px]" style={{ color: 'var(--tx2)' }} aria-live="polite">Processing…</span>}
          <button onClick={() => setSelected(new Set())} aria-label="Clear selection"
            className="ml-auto text-[11px]" style={{ color: 'var(--tx2)', background: 'none', border: 'none', cursor: 'pointer' }}>
            ✕ Clear
          </button>
        </div>
      )}

      {/* Products table */}
      <Card title={`Products (${filtered.length})`} action={undefined} id={undefined}>
        <div className="overflow-x-auto">
          <table id="products-table" className="w-full" role="table" aria-label={`Products list, ${filtered.length} results`}>
            <thead>
              <tr>
                <th id="col-select" scope="col" style={{ width: 32, paddingBottom: 8 }}>
                  <input type="checkbox"
                    aria-label={selected.size > 0 && selected.size === filtered.length ? 'Deselect all products' : 'Select all products'}
                    checked={selected.size > 0 && selected.size === filtered.length}
                    onChange={toggleSelectAll}
                    style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} />
                </th>
                {[['col-product','Product'],['col-category','Category'],['col-sku','SKU'],['col-size','Size'],['col-price','Selling Price'],['col-stock','Stock'],['col-status','Status'],['col-actions','Actions']].map(([id,h]) => (
                  <th key={id} id={id} scope="col" className="text-left text-[10px] font-bold uppercase tracking-wider pb-2 pr-4" style={{ color: 'var(--tx2,#6e9a75)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const pVars = variantStockMap[p.id] || [];
                const displayVars = pVars.filter(v => {
                  if (filterSize && v.variant_value !== filterSize) return false;
                  if (filterStock === 'out' && v.available_stock !== 0) return false;
                  if (filterStock === 'low' && !(v.available_stock > 0 && v.available_stock <= 5)) return false;
                  if (filterStock === 'ok' && !(v.available_stock > 10)) return false;
                  return true;
                });
                const rowVars  = displayVars.length > 0 ? displayVars : pVars;
                const rowCount = rowVars.length || 1;
                // BUG FIX (MEDIUM - Accessibility): rowSpan cells without headers/scope
                // cause NVDA+Firefox to mis-announce cell ownership. Added id/headers
                // associations so screen readers correctly map variant rows to their
                // product-level cells (checkbox, product name, category, status, actions).
                const rowGroupId = `rg-${p.id}`;

                return rowVars.length > 0 ? rowVars.map((v, i) => {
                  const avail      = v.available_stock ?? 0;
                  const stockColor = avail === 0 ? '#f85149' : avail <= 5 ? 'var(--yellow)' : '#3fb950';
                  const isFirst    = i === 0;
                  return (
                    <tr key={`${p.id}-${i}`} className="border-t hover:opacity-90 transition" style={{ borderColor: isFirst ? 'var(--bd,#1a5c2a)' : 'rgba(26,92,42,0.15)' }}>
                      {isFirst && (
                        <>
                          <td id={`${rowGroupId}-select`} rowSpan={rowCount} headers="col-select" style={{ width: 32, paddingRight: 4, verticalAlign: 'middle' }}>
                            <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)}
                              aria-label={`Select ${p.name}`} style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} />
                          </td>
                          <td id={`${rowGroupId}-product`} className="py-2.5 pr-4" rowSpan={rowCount} headers="col-product">
                            <div className="flex items-center gap-2">
                              {/* SECURITY FIX: allow-list check before rendering user-supplied image URL */}
                              {isSafeImageUrl(p.image_url) && <img src={p.image_url} alt={`${sanitizeText(p.name)} thumbnail`} className="w-8 h-8 rounded object-cover flex-shrink-0" style={{ border: '1px solid var(--bd,#1a5c2a)' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                              <div>
                                <div className="text-[13px] font-semibold" style={{ color: 'var(--tx,#fff)' }}>{p.emoji} {p.name}</div>
                                {(p._variantCount ?? 0) > 0 && <div className="text-[10px] mt-0.5" style={{ color: 'var(--blue)', background: 'var(--blue-bg)', borderRadius: 4, display: 'inline-block', padding: '1px 6px' }}>{p._variantCount} variants</div>}
                              </div>
                            </div>
                          </td>
                          <td id={`${rowGroupId}-category`} className="py-2.5 pr-4" rowSpan={rowCount} headers="col-category"><Badge type="blue">{catMap[String(p.category_id)] || '—'}</Badge></td>
                        </>
                      )}
                      <td className="py-1.5 pr-4 text-[10px]" headers={`col-sku ${rowGroupId}-product`} style={{ color: 'var(--tx2)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{v.sku || '—'}</td>
                      <td className="py-1.5 pr-4 text-[11px]" headers={`col-size ${rowGroupId}-product`} style={{ color: 'var(--tx,#fff)' }}>{v.variant_value || '—'}</td>
                      <td className="py-1.5 pr-4" headers={`col-price ${rowGroupId}-product`}>
                        <div className="text-[12px] font-bold" style={{ color: 'var(--tx,#fff)' }}>₹{(v.price ?? 0).toFixed(0)}</div>
                      </td>
                      <td className="py-1.5 pr-4 text-[11px] font-bold" headers={`col-stock ${rowGroupId}-product`} style={{ color: stockColor }}
                        aria-label={`Stock: ${avail}${avail === 0 ? ' (out of stock)' : avail <= 5 ? ' (low)' : ''}`}>
                        {avail}
                      </td>
                      {isFirst && (
                        <>
                          <td id={`${rowGroupId}-status`} className="py-2.5 pr-4" rowSpan={rowCount} headers="col-status">
                            <button onClick={() => toggleStatus(p)} aria-label={`Toggle status for ${p.name}, currently ${p.status || 'active'}`}>
                              <Badge type={p.status === 'active' ? 'green' : 'default'}>{p.status || 'active'}</Badge>
                            </button>
                          </td>
                          <td id={`${rowGroupId}-actions`} className="py-2.5" rowSpan={rowCount} headers="col-actions">
                            <div className="flex flex-col gap-1 items-start" role="group" aria-label={`Actions for ${p.name}`}>
                              <button onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`} className="text-[11px] px-3 py-1 rounded transition" style={{ color: 'var(--accent,#1a5c2a)', border: '1px solid var(--bd,#1a5c2a)' }}>Edit</button>
                              <button onClick={() => openVersionHistory(p)} aria-label={`View version history for ${p.name}`} className="text-[11px] px-2 py-1 rounded" style={{ background: 'rgba(188,140,255,0.08)', border: '1px solid rgba(188,140,255,0.25)', color: '#bc8cff' }}>📦</button>
                              {showArchived
                                ? <button onClick={() => restoreProduct(p)} aria-label={`Restore ${p.name}`} className="text-[11px] px-3 py-1 rounded transition" style={{ color: '#3fb950', border: '1px solid rgba(63,185,80,0.4)', background: 'rgba(63,185,80,0.08)' }}>↩ Restore</button>
                                : <button onClick={() => softDeleteProduct(p)} aria-label={`Archive ${p.name}`} className="text-[11px] px-3 py-1 rounded transition" style={{ color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>Archive</button>
                              }
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                }) : (
                  <tr key={p.id} className="border-t" style={{ borderColor: 'var(--bd,#1a5c2a)' }}>
                    <td><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} aria-label={`Select ${p.name}`} style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} /></td>
                    <td className="py-2.5 pr-4 text-[13px] font-semibold" style={{ color: 'var(--tx,#fff)' }}>{p.emoji} {p.name}</td>
                    <td><Badge type="blue">{catMap[String(p.category_id)] || '—'}</Badge></td>
                    <td colSpan={4} className="py-2.5 text-[11px]" style={{ color: 'var(--tx2)' }}>No variants</td>
                    <td><button onClick={() => toggleStatus(p)} aria-label={`Toggle status: ${p.status}`}><Badge type={p.status === 'active' ? 'green' : 'default'}>{p.status}</Badge></button></td>
                    <td className="py-2.5">
                      <div className="flex flex-col gap-1 items-start" role="group" aria-label={`Actions for ${p.name}`}>
                        <button onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`} className="text-[11px] px-3 py-1 rounded" style={{ color: 'var(--accent,#1a5c2a)', border: '1px solid var(--bd,#1a5c2a)' }}>Edit</button>
                        {showArchived
                          ? <button onClick={() => restoreProduct(p)} aria-label={`Restore ${p.name}`} className="text-[11px] px-3 py-1 rounded" style={{ color: '#3fb950', border: '1px solid rgba(63,185,80,0.4)', background: 'rgba(63,185,80,0.08)' }}>↩ Restore</button>
                          : <button onClick={() => softDeleteProduct(p)} aria-label={`Archive ${p.name}`} className="text-[11px] px-3 py-1 rounded" style={{ color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>Archive</button>
                        }
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Pagination */}
      {!loading && products.length > 0 && (
        <nav aria-label="Product list pagination" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--tx2)' }} aria-live="polite">
            {totalCount > 0
              ? `Page ${page + 1} of ${Math.ceil(totalCount / PAGE_SIZE)} · ${totalCount} total products`
              : `Page ${page + 1} · ${products.length} products shown`}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              aria-label="Previous page" aria-disabled={page === 0}
              style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.4 : 1, background: 'var(--bg2)', border: '1px solid var(--bd)', color: 'var(--tx)' }}>
              ← Prev
            </button>
            <button onClick={() => setPage(p => p + 1)}
              disabled={totalCount > 0 ? (page + 1) * PAGE_SIZE >= totalCount : products.length < PAGE_SIZE}
              aria-label="Next page"
              style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'var(--bg2)', border: '1px solid var(--bd)', color: 'var(--tx)' }}>
              Next →
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
