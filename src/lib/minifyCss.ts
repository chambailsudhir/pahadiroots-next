/**
 * Strips comments and collapses whitespace in a CSS string that is inlined into the page.
 *
 * The homepage inlines ~28 KB of component CSS (header, hero, tiles, footer) into the HTML, with developer comments and
 * indentation; the browser cannot ask for the hero image until it has the whole document, so every byte counts. Quoted strings
 * and url(...) values are left untouched, and whitespace before ":" is kept (".a :hover" and ".a:hover" mean different things).
 * Pure and idempotent, so it is safe to apply at render time (the page is cached).
 */
export function minifyCss(css: string): string {
  const s = css ?? ''
  const out: string[] = []
  // alternatives, in order: string / url() · comment · whitespace around { } ; , > · whitespace after ":" · other whitespace
  const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|url\([^)]*\))|\/\*[\s\S]*?\*\/|\s*([{};,>])\s*|(:)\s*|(\s+)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index))
    last = re.lastIndex
    if (m[1] !== undefined) out.push(m[1])
    else if (m[2] !== undefined) {
      if (m[2] === '}' && out.length && out[out.length - 1] === ';') out.pop()   // ";}" -> "}"
      out.push(m[2])
    }
    else if (m[3] !== undefined) out.push(':')
    else if (m[4] !== undefined) out.push(' ')
    // comments: dropped
  }
  if (last < s.length) out.push(s.slice(last))
  return out.join('').trim()
}
