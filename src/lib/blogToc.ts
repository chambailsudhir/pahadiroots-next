// Adds stable ids to the <h2> headings of an already-sanitized article body and returns the
// table of contents. Runs AFTER sanitizeHtml (which strips attributes such as id).
export interface TocItem { id: string; text: string }

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

export function addHeadingIds(html: string): { html: string; toc: TocItem[] } {
  const toc: TocItem[] = []
  const used = new Set<string>()
  const out = html.replace(/<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/gi, (_m, _attrs, inner: string) => {
    const text = stripTags(inner)
    let base = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section'
    let id = base, n = 2
    while (used.has(id)) id = `${base}-${n++}`
    used.add(id)
    if (text) toc.push({ id, text })
    return `<h2 id="${id}">${inner}</h2>`
  })
  return { html: out, toc }
}
