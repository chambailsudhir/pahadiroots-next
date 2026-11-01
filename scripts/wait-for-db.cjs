#!/usr/bin/env node
/**
 * Runs before `next build` on Vercel (see buildCommand in vercel.json).
 *
 * The build prerenders pages from Supabase. If the database is unreachable at that moment the build fails — which is the right
 * outcome (the previous deployment keeps serving; shipping a storefront with no products would be worse) — but a brief blip
 * should not cost a whole failed deploy. This waits, politely, for the database to answer before the build starts, and fails
 * fast with a clear message if it never does instead of burning ~10 minutes on a build that cannot succeed.
 *
 * Skipped (exit 0) when the Supabase env vars are not present, so it can never block a build that does not use them.
 */
const TOTAL_WAIT_MS = Number(process.env.WAIT_FOR_DB_TOTAL_MS || 180_000)
const EVERY_MS = Number(process.env.WAIT_FOR_DB_EVERY_MS || 10_000)
const TIMEOUT_MS = 8_000

async function probe(url, key, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${url}/rest/v1/site_settings?select=key&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

async function waitForDb({ url, key, totalMs = TOTAL_WAIT_MS, everyMs = EVERY_MS, fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, log = console.log } = {}) {
  if (!url || !key) { log('[wait-for-db] Supabase env vars not set — skipping.'); return true }
  const started = now()
  for (let attempt = 1; ; attempt++) {
    if (await probe(url, key, fetchImpl)) { log(`[wait-for-db] database is answering (attempt ${attempt}).`); return true }
    const waited = now() - started
    if (waited + everyMs > totalMs) {
      log(`[wait-for-db] database did not answer within ${Math.round(totalMs / 1000)} s. Failing the build on purpose: the previous deployment stays live. Retry the deploy once Supabase is healthy.`)
      return false
    }
    log(`[wait-for-db] not answering yet (attempt ${attempt}); retrying in ${Math.round(everyMs / 1000)} s…`)
    await sleep(everyMs)
  }
}

module.exports = { waitForDb, probe }

if (require.main === module) {
  waitForDb({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY })
    .then(ok => process.exit(ok ? 0 : 1))
}
