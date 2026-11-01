import { createHash, randomBytes } from 'node:crypto'
import { PREMIUM_BOOT_SCRIPT } from '@/lib/premiumMode'
import { ANALYTICS_URL_GUARD_SCRIPT } from '@/lib/analyticsGuard'
import { consentBootstrapScript, consentBootstrapInputs } from '@/lib/consent'
import { buildCsp } from '@/lib/csp'

/**
 * Strict Content-Security-Policy for the pages where a script-injection bug would cost the most: checkout (payment) and the
 * signed-in account area.
 *
 * Those pages are rendered per request (force-dynamic), so the proxy can mint a fresh nonce for each response. The policy then
 * allows inline scripts only if they carry that nonce (Next stamps its own bootstrap/flight scripts automatically when it sees
 * the policy on the request) or match the SHA-256 of one of our three fixed inline scripts from the root layout. 'unsafe-inline'
 * is NOT present, so injected `<script>` text or `onerror=` handlers do nothing. Every other page keeps the cache-friendly
 * policy from next.config.js — nonces would make them dynamic and slow.
 */
export const STRICT_CSP_PATH = /^\/(checkout|account)(\/|$)/

export const sha256b64 = (text: string) => createHash('sha256').update(text, 'utf8').digest('base64')
export const makeNonce = () => randomBytes(16).toString('base64')

export interface StrictCspInput { pathname: string; nonce: string; google_tag_id?: string | null; cookie_consent_mode?: string | null }

/** Hashes of every inline script the root layout renders (the consent bootstrap depends on two owner settings). */
export function layoutScriptHashes(s: { google_tag_id?: string | null; cookie_consent_mode?: string | null }): string[] {
  const { tagId, consentMode } = consentBootstrapInputs(s)
  return [PREMIUM_BOOT_SCRIPT, ANALYTICS_URL_GUARD_SCRIPT, consentBootstrapScript(tagId, consentMode)].map(sha256b64)
}

export function buildStrictCsp(i: StrictCspInput): string {
  return buildCsp({
    allowEval: /^\/checkout(\/|$)/.test(i.pathname),   // Razorpay's checkout.js needs it; nothing else does
    nonce: i.nonce,
    scriptHashes: layoutScriptHashes(i),
  })
}
