/**
 * Business rule (Nov 2026): the storefront has no newsletter, email subscription or "subscribe and save" feature —
 * not on the homepage, footer, popups, checkout or anywhere else. This scans every page and component for user-facing
 * newsletter / subscription wording (comments are stripped first, so explanatory notes about the removal are fine).
 * API routes are excluded: account export / deletion must still handle subscriber records collected in the past.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const ROOTS = ['src/app', 'src/components']
const BANNED = /newsletter|subscription|subscribe\s+(to|for|now)|subscribe\s*&\s*save|sign\s*up\s+for\s+(updates|offers)/i

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'api' ? [] : files(p)
    return /\.(tsx|ts)$/.test(name) ? [p] : []
  })
}

function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')   // JSX comments
    .replace(/\/\*[\s\S]*?\*\//g, '')       // block comments
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')  // line comments (not URLs)
}

describe('no newsletter or subscription UI', () => {
  it('no page or component shows newsletter / subscription wording', () => {
    const offenders = ROOTS.flatMap(files).filter(f => BANNED.test(stripComments(readFileSync(f, 'utf8'))))
    expect(offenders).toEqual([])
  })
})
