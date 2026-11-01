// Health-claim guard (Nov 2026 review). Food advertising in India is restricted (FSSAI Advertising and Claims
// Regulations, 2018; Consumer Protection Act, 2019): health or disease-risk claims must not be made without approval.
// These tests keep claim wording out of the code-owned customer copy and the chatbot instructions.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const get = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8')
const pdp = get('app/products/[slug]/page.tsx')
const prompt = get('app/api/chat/systemPrompt.ts')

describe('product page copy', () => {
  it('uses "Highlights", not "Key Benefits", for the DB-driven highlight cards', () => {
    expect(pdp).toContain('✨ Highlights')
    expect(pdp).not.toContain('✨ Key Benefits')
  })
  it('shows a traditional-use / not-medical-advice note under the highlight cards', () => {
    expect(pdp).toContain('Traditional use and general information. Not medical advice')
  })
  it('sea buckthorn sections make no nutrient or vitamin claims', () => {
    for (const bad of ['nutrient-packed', 'nutrient-dense', 'rich in nutrients', 'natural vitamins', 'omegas and antioxidants', 'rich in natural nutrients']) {
      expect(pdp).not.toContain(bad)
    }
  })
})

describe('chatbot instructions', () => {
  it('allows only the soft traditional wording and forbids disease or cure claims', () => {
    expect(prompt).toContain('NEVER state or imply that any product prevents, treats, cures or heals any disease or health condition')
    expect(prompt).toContain('soft, traditional-use wording already shown on the product pages')
    expect(prompt).not.toMatch(/honey boosts immunity/i)
  })
})
