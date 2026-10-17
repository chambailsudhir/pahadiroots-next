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
// WHAT IT DOES (tokenizer, not regex-on-tags):
//   - Walks the string once, parsing each tag with real quote handling, so a '>' inside a
//     quoted attribute value can no longer end the tag early (PDP audit P1-1: the previous
//     regex let <img alt=">" onerror=...> through untouched).
//   - Keeps only allowlisted tags and per-tag allowlisted attributes; everything is re-emitted
//     from parsed pieces (names lower-cased, values decoded, validated, re-escaped, double-quoted).
//   - href/src are checked AFTER HTML-entity decoding and with control chars/whitespace removed,
//     so &#106;avascript: and java<TAB>script: are caught. Only http(s)/mailto, site-relative
//     (/path, not //host) and #fragment are allowed.
//   - Drops script/style/iframe/object/embed/form/input/button/select/textarea/svg/math/template/
//     noscript elements together with their content; drops comments; escapes stray '<'.
// ─────────────────────────────────────────────────────────────────────────────
import 'server-only'

// Tags we allow through
const ALLOWED_TAGS = new Set([
  'p','br','strong','b','em','i','u','s',
  'ul','ol','li',
  'h2','h3','h4','h5','h6',
  'blockquote','pre','code',
  'div','span','section','article',
  'table','thead','tbody','tr','th','td',
  'hr',
  'a','img',
])

// Elements removed together with everything inside them.
const DROP_WITH_CONTENT = new Set([
  'script','style','iframe','object','embed','form','input','button','select','textarea',
  'svg','math','template','noscript','title','head',
])
// Elements that never have content (no matching close tag to wait for).
const VOID_TAGS = new Set(['br','hr','img','input','embed'])

type Attr = [name: string, value: string]
interface ParsedTag { name: string; closing: boolean; selfClosing: boolean; attrs: Attr[]; end: number }

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n',
  nbsp: '\u00a0', sol: '/', lpar: '(', rpar: ')', semi: ';', equals: '=', num: '#', percnt: '%',
}

/** Decode the HTML character references a browser would decode inside an attribute value (one pass). */
function decodeEntities(v: string): string {
  return v.replace(/&(?:#(\d{1,7});?|#[xX]([0-9a-fA-F]{1,6});?|([a-zA-Z]{2,8});)/g, (m, dec, hex, name) => {
    if (dec || hex) {
      const cp = dec ? parseInt(dec, 10) : parseInt(hex, 16)
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '\ufffd'
      return String.fromCodePoint(cp)
    }
    const r = NAMED_ENTITIES[String(name).toLowerCase()]
    return r === undefined ? m : r
  })
}

const escAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const stripCtl = (v: string) => v.replace(/[\u0000-\u001f\u007f]/g, '')

/** Allow http(s)/mailto, a single-slash site path, or a #fragment. Checked on the DECODED value. */
function isSafeUrl(decoded: string): boolean {
  // Browsers strip tabs/newlines and leading control/space chars before parsing the scheme.
    const probe = decoded.replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '')
  if (!probe) return false
  if (/^(https?|mailto):/i.test(probe)) return true
  if (probe.startsWith('#')) return true
  if (probe.startsWith('/') && !probe.startsWith('//') && !probe.startsWith('/\\')) return true
  return false
}

/** Parse one tag starting at s[lt] === '<'. Returns null when it is not a well-formed tag. */
function parseTag(s: string, lt: number): ParsedTag | null {
  const n = s.length
  let j = lt + 1
  let closing = false
  if (s[j] === '/') { closing = true; j++ }
  const nm = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(s.slice(j, j + 64))
  if (!nm) return null
  const name = nm[0].toLowerCase()
  j += nm[0].length
  const attrs: Attr[] = []
  let selfClosing = false
  for (;;) {
    while (j < n && /\s/.test(s[j])) j++
    if (j >= n) return null                       // unterminated tag
    const ch = s[j]
    if (ch === '>') return { name, closing, selfClosing, attrs, end: j + 1 }
    if (ch === '/') { if (s[j + 1] === '>') selfClosing = true; j++; continue }
    const am = /^[^\s"'<>\/=]+/.exec(s.slice(j, j + 128))
    if (!am) { j++; continue }                     // stray quote / '=' etc.
    const aname = am[0].toLowerCase()
    j += am[0].length
    while (j < n && /\s/.test(s[j])) j++
    let value = ''
    if (s[j] === '=') {
      j++
      while (j < n && /\s/.test(s[j])) j++
      const q = s[j]
      if (q === '"' || q === "'") {
        const close = s.indexOf(q, j + 1)
        if (close === -1) return null              // unterminated quoted value
        value = s.slice(j + 1, close)
        j = close + 1
      } else {
        const um = /^[^\s>]*/.exec(s.slice(j))
        value = um ? um[0] : ''
        j += value.length
      }
    }
    attrs.push([aname, value])
  }
}

/** Rebuild an allowed opening tag from validated attributes only. */
function buildOpenTag(tag: ParsedTag): string {
  const out: string[] = []
  const seen = new Set<string>()
  let blank = false
  for (const [rawName, rawVal] of tag.attrs) {
    if (seen.has(rawName)) continue
    seen.add(rawName)
    if (rawName.startsWith('on')) continue
    const v = stripCtl(decodeEntities(rawVal))
    if (tag.name === 'a') {
      if (rawName === 'href') { if (isSafeUrl(decodeEntities(rawVal))) out.push(`href="${escAttr(v)}"`) }
      else if (rawName === 'title') out.push(`title="${escAttr(v)}"`)
      else if (rawName === 'target' && v.toLowerCase() === '_blank') blank = true
    } else if (tag.name === 'img') {
      if (rawName === 'src') { if (isSafeUrl(decodeEntities(rawVal))) out.push(`src="${escAttr(v)}"`) }
      else if (rawName === 'alt') out.push(`alt="${escAttr(v)}"`)
      else if ((rawName === 'width' || rawName === 'height') && /^\d{1,5}$/.test(v.trim())) out.push(`${rawName}="${v.trim()}"`)
      else if (rawName === 'loading' && /^(lazy|eager)$/i.test(v.trim())) out.push(`loading="${v.trim().toLowerCase()}"`)
    } else if (tag.name === 'td' || tag.name === 'th') {
      if ((rawName === 'colspan' || rawName === 'rowspan') && /^\d{1,3}$/.test(v.trim())) out.push(`${rawName}="${v.trim()}"`)
      else if (tag.name === 'th' && rawName === 'scope' && /^(row|col|rowgroup|colgroup)$/i.test(v.trim())) out.push(`scope="${v.trim().toLowerCase()}"`)
    }
  }
  if (tag.name === 'a' && blank) out.push('target="_blank"', 'rel="noopener noreferrer"')
  return `<${tag.name}${out.length ? ' ' + out.join(' ') : ''}>`
}

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
  const s = String(dirty)
  const n = s.length
  let out = ''
  let i = 0
  let skipUntil: string | null = null            // dropping the content of this element

  while (i < n) {
    const lt = s.indexOf('<', i)
    if (lt === -1) { if (!skipUntil) out += s.slice(i); break }
    if (!skipUntil) out += s.slice(i, lt)

    if (s.startsWith('<!--', lt)) {                // comment
      const end = s.indexOf('-->', lt + 4)
      i = end === -1 ? n : end + 3
      continue
    }
    if (s[lt + 1] === '!' || s[lt + 1] === '?') {  // doctype / CDATA / processing instruction
      const end = s.indexOf('>', lt)
      i = end === -1 ? n : end + 1
      continue
    }

    const tag = parseTag(s, lt)
    if (!tag) {                                    // a lone '<' (or an unterminated tag): show it as text
      if (!skipUntil) out += '&lt;'
      i = lt + 1
      continue
    }
    i = tag.end

    if (skipUntil) {
      if (tag.closing && tag.name === skipUntil) skipUntil = null
      continue
    }
    if (DROP_WITH_CONTENT.has(tag.name)) {
      if (!tag.closing && !tag.selfClosing && !VOID_TAGS.has(tag.name)) skipUntil = tag.name
      continue
    }
    if (!ALLOWED_TAGS.has(tag.name)) continue      // unknown tag: drop the tag, keep its text
    if (tag.closing) {
      if (!VOID_TAGS.has(tag.name)) out += `</${tag.name}>`
      continue
    }
    out += buildOpenTag(tag)
  }
  return out.trim()
}
