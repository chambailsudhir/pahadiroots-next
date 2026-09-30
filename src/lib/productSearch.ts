/**
 * productSearch.ts — forgiving, typo-tolerant product name matching.
 *
 * WHY THIS EXISTS: search used to be a plain SQL `ILIKE '%query%'` on the
 * product name. That is a literal substring match, so:
 *   - "seab"        → 0 results for "Sea Buckthorn" (the space in the name
 *                     sits between "sea" and "buck", so "seab" is not a
 *                     substring of "sea buckthorn")
 *   - "sea buck"    → matches, but "seabuck" doesn't
 *   - "hunny"/"gee" → nothing, even though it is obviously honey / ghee
 *
 * The catalog is small (tens of products), so we fetch the active catalog
 * once (cached by SWR) and rank it client-side with these rules, best first:
 *
 *   1. Spaces/punctuation are ignored on BOTH sides ("seab" ≈ "sea b…",
 *      "sea buck" ≈ "seabuck").
 *   2. Every word the user typed must match somewhere in the name, either
 *      as a prefix of a name word or as a substring of the space-less name.
 *   3. Small typos are forgiven (1 edit for 4 letters, 2 edits for 5+ that share the first letter),
 *      including swapped letters ("hoeny" → honey). Words of 3 letters or
 *      fewer must match exactly (too ambiguous to guess).
 */

/** lowercase, strip accents, turn everything that isn't a letter/digit into a space */
export function normalizeSearchText(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** Damerau–Levenshtein (optimal string alignment): insert/delete/replace/swap = 1 edit. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const al = a.length, bl = b.length
  if (!al) return bl
  if (!bl) return al
  const d: number[][] = Array.from({ length: al + 1 }, () => new Array<number>(bl + 1).fill(0))
  for (let i = 0; i <= al; i++) d[i][0] = i
  for (let j = 0; j <= bl; j++) d[0][j] = j
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[al][bl]
}

function allowedTypos(len: number): number {
  if (len <= 3) return 0
  if (len === 4) return 1
  return 2 // 5+ letters; 2-edit matches must also share the first letter (see below)
}

/** distance within tolerance? 2-edit matches must start with the same letter to avoid random hits */
function withinTypos(token: string, cand: string, tol: number): number {
  const dist = editDistance(token, cand)
  if (dist > tol) return -1
  if (dist === 2 && token[0] !== cand[0]) return -1
  return dist
}

/**
 * Score how well ONE query token matches a name. 0 = no match.
 * Higher is better. `words` are the normalized name words, `compact` is the
 * name with all spaces removed.
 */
function scoreToken(token: string, words: string[], compact: string): number {
  // exact word
  if (words.includes(token)) return 100
  // prefix of a word ("buck" → "buckthorn")
  if (words.some(w => w.startsWith(token))) return 90
  // substring anywhere in the space-less name — this is what makes
  // "seab" and "seabuck" find "Sea Buckthorn"
  if (compact.startsWith(token)) return 85
  if (compact.includes(token)) return 70

  // typo tolerance
  const tol = allowedTypos(token.length)
  if (tol === 0) return 0
  let best = 0
  for (const w of words) {
    // compare against the word itself and against a same-length prefix of it,
    // so half-typed words with a typo ("hone" for "honey", "buckthron") still match
    const cand = [w, w.slice(0, token.length), w.slice(0, token.length + 1)]
    for (const c of cand) {
      if (c.length < 3) continue
      const dist = withinTypos(token, c, tol)
      if (dist >= 0) best = Math.max(best, 60 - dist * 10)
    }
  }
  // also allow a typo against the space-less name prefix ("seabukthorn")
  const cp = compact.slice(0, token.length)
  const cd = withinTypos(token, cp, tol)
  if (cd >= 0) best = Math.max(best, 55 - cd * 10)
  return best
}

/** 0 = no match. Otherwise higher = better. */
export function scoreProductName(name: string, query: string): number {
  const q = normalizeSearchText(query)
  if (!q) return 0
  const n = normalizeSearchText(name)
  if (!n) return 0
  const words = n.split(' ')
  const compact = n.replace(/ /g, '')
  const qCompact = q.replace(/ /g, '')

  // Whole query, spaces ignored, is inside the name ("sea buck", "seabuck", "seab")
  if (n === q) return 200
  if (compact === qCompact) return 190
  if (n.startsWith(q) || compact.startsWith(qCompact)) return 150
  if (compact.includes(qCompact)) return 130

  // Otherwise every typed word has to match something
  const tokens = q.split(' ')
  let total = 0
  for (const t of tokens) {
    const s = scoreToken(t, words, compact)
    if (s === 0) {
      // maybe the user split one word into two ("butter milk" → "buttermilk"): handled above
      // via the compact check; nothing else to try for this token.
      return 0
    }
    total += s
  }
  return total / tokens.length
}

/**
 * Rank items by name match, best first. Ties keep the original catalog order
 * (Array.prototype.sort is stable).
 */
export function searchProducts<T extends { name: string; slug?: string | null }>(
  items: readonly T[],
  query: string,
  limit?: number,
): T[] {
  const q = normalizeSearchText(query)
  if (q.length < 2) return []
  const ranked = items
    .map((item, idx) => {
      // also let the URL slug contribute (e.g. slug "sea-buckthorn" when the display name is just "Sea Buckthorn Pulp")
      const s = Math.max(
        scoreProductName(item.name, query),
        item.slug ? scoreProductName(item.slug.replace(/-/g, ' '), query) - 5 : 0,
      )
      return { item, s, idx }
    })
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.idx - b.idx)
    .map(x => x.item)
  return typeof limit === 'number' ? ranked.slice(0, limit) : ranked
}
