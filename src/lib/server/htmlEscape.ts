// ─────────────────────────────────────────────────────────────────────────────
// lib/server/htmlEscape.ts
//
// Minimal HTML entity escaper for email template interpolation.
// Prevents XSS via user-supplied strings (name, address fields, etc.)
// when those values are interpolated into HTML email bodies.
//
// We deliberately do NOT use a third-party library to keep the
// dependency surface small — this covers the five critical HTML
// characters that enable injection in an HTML context.
// ─────────────────────────────────────────────────────────────────────────────
import 'server-only'

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&':  '&amp;',
  '<':  '&lt;',
  '>':  '&gt;',
  '"':  '&quot;',
  "'":  '&#x27;',
}

/**
 * Escape a user-supplied string for safe interpolation into an HTML context.
 * Call this on every value that comes from user input before placing it
 * inside an HTML email template.
 */
export function esc(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[&<>"']/g, ch => HTML_ESCAPE_MAP[ch] ?? ch)
}
