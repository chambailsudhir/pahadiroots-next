// ─────────────────────────────────────────────────────────────────────────────
// lib/serverFieldError.ts  (client-safe, pure)
//
// Nov 2026 audit: the order / payment APIs answer a failed validation with `{ error: 'Invalid request', details }` where
// `details` is zod's `error.flatten()` — `{ formErrors: string[], fieldErrors: { address: string[] } }`. The COD path assumed a
// flat `{ field: string[] }` map and did `Object.values(details).flat().find(Boolean)`, which returns the `fieldErrors` OBJECT, so
// the customer saw "[object Object]"; the online path ignored `details` and showed only "Invalid request". This picks the first
// real message out of either shape so the customer is told what to fix.
// ─────────────────────────────────────────────────────────────────────────────

function firstString(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() ? v : undefined
  if (Array.isArray(v)) {
    for (const x of v) { const s = firstString(x); if (s) return s }
    return undefined
  }
  if (v && typeof v === 'object') {
    for (const x of Object.values(v as Record<string, unknown>)) { const s = firstString(x); if (s) return s }
  }
  return undefined
}

/** First human-readable validation message in a zod-flatten (or flat field map) `details` payload, else undefined. */
export function firstServerFieldError(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') return undefined
  const d = details as { fieldErrors?: unknown; formErrors?: unknown }
  // field-level messages are the most actionable, so they win over form-level ones
  return firstString(d.fieldErrors) ?? firstString(d.formErrors) ?? firstString(details)
}
