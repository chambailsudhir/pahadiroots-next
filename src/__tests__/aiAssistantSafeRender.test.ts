// @vitest-environment jsdom
/** AUDIT S2-007: model output and grounding sources are never rendered via innerHTML. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, '../../public/js/ai-assistant.js'), 'utf8')
function extract(name: string): string {
  const start = src.indexOf(`  function ${name}(`)
  const end = src.indexOf('\n  }\n', start) + 4
  return src.slice(start, end)
}
const helpers = new Function(`${extract('renderRichText')}\n${extract('safeHttpUrl')}\nreturn { renderRichText, safeHttpUrl }`)() as {
  renderRichText: (el: HTMLElement, text: string) => void
  safeHttpUrl: (raw: string) => string | null
}

describe('ai-assistant safe rendering', () => {
  it('a hostile bot reply becomes text, not markup', () => {
    const el = document.createElement('div')
    helpers.renderRichText(el, '<img src=x onerror=alert(1)> **bold** line\nnext')
    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(el.querySelector('strong')?.textContent).toBe('bold')
    expect(el.querySelectorAll('br').length).toBe(1)
  })
  it('source URLs must be http(s)', () => {
    expect(helpers.safeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(helpers.safeHttpUrl('data:text/html,hi')).toBeNull()
    expect(helpers.safeHttpUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
  })
  it('the widget no longer assigns model text or source HTML through innerHTML, and sends no system prompt', () => {
    expect(src).not.toMatch(/bbl\.innerHTML/)
    expect(src).not.toMatch(/srcDiv\.innerHTML/)
    expect(src).not.toContain('system_instruction')
    expect(src).not.toContain('buildSystemPrompt(')
  })
})
