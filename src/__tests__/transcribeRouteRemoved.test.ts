/** AUDIT S2-008: /api/transcribe had no caller (voice uses browser SpeechRecognition) — a paid endpoint with no consumer is removed. */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('transcribe route', () => {
  it('no longer exists and nothing in public/js calls it', () => {
    expect(existsSync(join(__dirname, '../app/api/transcribe/route.ts'))).toBe(false)
    expect(readFileSync(join(__dirname, '../../public/js/ai-assistant.js'), 'utf8')).not.toContain('/api/transcribe')
  })
})
