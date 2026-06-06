// ─── Price ────────────────────────────────────────────────────────────────────

export function formatPrice(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN')
}

export function savingsPercent(mrp: number, price: number): number {
  if (!mrp || mrp <= price) return 0
  return Math.round(((mrp - price) / mrp) * 100)
}

// ─── Date ─────────────────────────────────────────────────────────────────────

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

// ─── String ───────────────────────────────────────────────────────────────────

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-')
}

// ─── CSS class merge (no clsx dep needed) ────────────────────────────────────

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

// ─── Parse AI JSON arrays ─────────────────────────────────────────────────────

export function parseJsonArray(str: string | null): string[] {
  if (!str) return []
  try {
    const parsed = JSON.parse(str)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// ─── Idempotency ──────────────────────────────────────────────────────────────

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

// ─── GST Calculation ──────────────────────────────────────────────────────────

export function calcGST(price: number, gstRate: number, qty = 1): number {
  // Price is inclusive of GST
  // GST amount = price * gstRate / (100 + gstRate)
  return Math.round((price * qty * gstRate) / (100 + gstRate))
}

/**
 * Split total GST into CGST + SGST (intra-state) or return IGST (inter-state).
 *
 * CRITICAL: Never use Math.round for both halves — for odd-paise GST amounts
 * (e.g. ₹5 total GST = 2.5 + 2.5 paise) double-rounding produces 3+3=6 ≠ 5.
 * Fix: floor the first half, assign the remainder to the second.
 *
 * @param gstPaise   Total GST in paise (integer, output of calcGST * 100)
 * @param interState True when supplier state ≠ customer state → single IGST line
 */
export function splitGST(
  gstPaise: number,
  interState = false,
): { cgst: number; sgst: number; igst: number } {
  if (interState) {
    return { cgst: 0, sgst: 0, igst: gstPaise }
  }
  const cgst = Math.floor(gstPaise / 2)
  const sgst = gstPaise - cgst   // absorbs the odd paise — total always correct
  return { cgst, sgst, igst: 0 }
}

// ─── Truncate ────────────────────────────────────────────────────────────────

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen).trimEnd() + '…'
}

// ─── Phone number format ─────────────────────────────────────────────────────

export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`
  return phone
}

// ─── WhatsApp URL ─────────────────────────────────────────────────────────────

export function whatsappURL(number: string, message: string): string {
  const digits = number.replace(/\D/g, '')
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

// ─── Settings helpers (used by pricingService) ────────────────────────────────

export function asNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue
  const n = parseFloat(value)
  return isNaN(n) ? defaultValue : n
}

export function isEnabled(value: string | undefined, defaultValue = true): boolean {
  if (value === undefined) return defaultValue
  return value !== 'false'
}

// ─── Safe category slug (fallback: slugify name) ─────────────────────────────
// Prevents /collections/Wild%20Honey — always returns a clean URL slug
export function catSlug(cat: { slug?: string | null; name?: string | null; id?: number | string }): string {
  return (cat.slug || '').trim() || slugify(cat.name || '') || String(cat.id)
}
