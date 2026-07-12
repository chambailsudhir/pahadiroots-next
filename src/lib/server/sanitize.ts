// ─────────────────────────────────────────────────────────────────────────────
// lib/server/sanitize.ts
//
// Server-safe allowlist HTML sanitizer for dangerouslySetInnerHTML content.
//
// WHY NOT isomorphic-dompurify:
//   The project already hit this: isomorphic-dompurify's browser DOM shim
//   triggers ESM resolution errors in Next.js 14 App Router server routes on
//   Vercel cold starts. See the note in src/app/api/v1/actions/route.ts.
//
// This file is marked `server-only` so it can never be accidentally imported
// by a client component and bundled into the browser JS.
//
// WHAT IT DOES:
//   - Strips all tags not on the allowlist
//   - Strips all attributes except safe ones per-tag
//   - Removes javascript: / data: URLs from href/src
//   - Removes on* event handlers
// ─────────────────────────────────────────────────────────────────────────────
import 'server-only'

// Tags we allow through unchanged
const ALLOWED_TAGS = new Set([
  'p','br','strong','b','em','i','u','s',
  'ul','ol','li',
  'h2','h3','h4','h5','h6',
  'blockquote','pre','code',
  'div','span','section','article',
  'table','thead','tbody','tr','th','td',
  'hr',
  // BUG FIX: 'a' and 'img' were missing here even though ALLOWED_ATTRS
  // below already defines their allowed attributes — meaning every link
  // and image in sanitized content was silently stripped to plain text
  // (links) or vanished entirely (images, which have no inner text to
  // preserve). Dangerous protocols (javascript:, data:) on these tags are
  // still neutralized separately below.
  'a','img',
])

// Attributes allowed per-tag (global: class, id, style stripped intentionally —
// content comes from our own DB/AI pipeline so class/style aren't needed)
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a:   new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading']),
  td:  new Set(['colspan', 'rowspan']),
  th:  new Set(['colspan', 'rowspan', 'scope']),
}

// Protocols allowed in href/src
const SAFE_PROTOCOLS = /^(https?|mailto):/i

/**
 * Strip ALL HTML tags and trim whitespace from a user-supplied string.
 * Use this on address fields and other free-text inputs before writing to the
 * DB or interpolating into email templates. Complementary to esc(): call
 * sanitize() first (removes tags), then esc() (encodes remaining chars).
 *
 * Previously duplicated inline in orders/route.ts and payments/route.ts.
 * Single source of truth here.
 *
 * Returns '' for null / undefined so callers don't need null-guards.
 */
export function sanitize(str: string | undefined | null): string {
  if (!str) return ''
  return str.replace(/<[^>]*>/g, '').trim()
}

/**
 * Sanitize an HTML string for safe use with dangerouslySetInnerHTML.
 *
 * @param dirty  Raw HTML from DB / AI pipeline
 * @returns      Safe HTML string with dangerous content removed
 */
export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return ''

  return dirty
    // 1. Remove script / style / iframe / object / embed blocks entirely
    .replace(/<(script|style|iframe|object|embed|form|input|button|select|textarea)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|input|button|select|textarea)[^>]*\/?\s*>/gi, '')

    // 2. Strip tags not on the allowlist (keep content, remove tag)
    .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (match, tag: string) => {
      const lowerTag = tag.toLowerCase()
      if (!ALLOWED_TAGS.has(lowerTag)) {
        // Remove the tag entirely but keep inner text
        return ''
      }

      // 3. For allowed tags, strip disallowed attributes
      const allowedAttrs = ALLOWED_ATTRS[lowerTag] ?? new Set<string>()
      return match.replace(/\s([a-z][a-z0-9-]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/gi,
        (attrMatch, attrName: string) => {
          const lowerAttr = attrName.toLowerCase()

          // Remove all event handlers
          if (lowerAttr.startsWith('on')) return ''

          if (!allowedAttrs.has(lowerAttr)) return ''

          // For href/src, validate protocol
          const valMatch = attrMatch.match(/=\s*["']?([^"'\s>]*)["']?/)
          if (valMatch && (lowerAttr === 'href' || lowerAttr === 'src')) {
            const val = valMatch[1].trim()
            if (val && !SAFE_PROTOCOLS.test(val) && !val.startsWith('/') && !val.startsWith('#')) {
              return ''
            }
          }

          return attrMatch
        }
      )
    })

    // 4. Sanitize any remaining javascript: / data: that slipped through
    .replace(/javascript\s*:/gi, 'x-removed:')
    .replace(/data\s*:/gi,       'x-removed:')
    .trim()
}
