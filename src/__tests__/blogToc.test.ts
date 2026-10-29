import { describe, it, expect } from 'vitest'
import { addHeadingIds } from '@/lib/blogToc'

describe('addHeadingIds', () => {
  it('adds slug ids to h2 headings and returns the table of contents', () => {
    const { html, toc } = addHeadingIds('<h2>What Makes It Different</h2><p>x</p><h2>How It&#39;s <em>Made</em> &amp; Stored</h2><h3>Sub</h3>')
    expect(toc).toEqual([
      { id: 'what-makes-it-different', text: 'What Makes It Different' },
      { id: 'how-it-39-s-made-stored', text: "How It&#39;s Made & Stored" },
    ])
    expect(html).toContain('<h2 id="what-makes-it-different">')
    expect(html).toContain('<h3>Sub</h3>')
  })
  it('keeps ids unique when headings repeat', () => {
    const { toc } = addHeadingIds('<h2>FAQ</h2><h2>FAQ</h2><h2>FAQ</h2>')
    expect(toc.map(t => t.id)).toEqual(['faq', 'faq-2', 'faq-3'])
  })
  it('falls back to a generic id and skips empty headings in the toc', () => {
    const { html, toc } = addHeadingIds('<h2>   </h2><h2>%%%</h2>')
    expect(toc.map(t => t.id)).toEqual(['section-2'])
    expect(html).toContain('id="section"')
  })
  it('leaves content without h2 untouched', () => {
    const { html, toc } = addHeadingIds('<p>hello</p>')
    expect(html).toBe('<p>hello</p>')
    expect(toc).toEqual([])
  })
})
