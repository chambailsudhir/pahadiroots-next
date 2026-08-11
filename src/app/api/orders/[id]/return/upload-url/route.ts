// ─────────────────────────────────────────────────────────────
// POST /api/orders/[id]/return/upload-url — signed upload URL for
// return/replacement photo evidence (damaged item, wrong item, etc.)
//
//  ✅ Token auth + refresh, CSRF check, ownership check — same pattern as
//     the sibling /return route (this order must belong to the caller)
//  ✅ Gated server-side by site_settings.return_photo_upload_enabled —
//     never trust a client-side toggle check alone; if admin has turned
//     this off, no signed URL is issued regardless of what the client sends
//  ✅ Browser uploads directly to Supabase Storage (signed URL) — the file
//     never touches this serverless function, avoiding Vercel's request
//     body size limit. Mirrors pahadi-admin's own get_upload_url pattern
//     (src/app/api/admin/route.js) exactly, just customer-scoped instead
//     of admin-role-scoped, and written to a `returns/` prefix rather than
//     the product-image root.
//  ✅ fileName/fileType sanitized with the same rules as pahadi-admin's
//     _sanitizeFileName/_sanitizeFileType (path traversal / MIME
//     injection prevention) — kept in sync manually since the two repos
//     don't share code, but the logic must match or a gap opens up.
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import {
  ok, fail,
  sbAuth, sbAdmin,
  getToken, tryRefresh, applyNewCookies,
  syncCustomerProfile,
  checkCsrf,
} from '@/lib/api/serverUtils'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!
const BUCKET        = 'pahadi-images'
const MAX_PHOTOS_PER_RETURN = 4

const ALLOWED_FILE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function sanitizeFileName(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return null
  const clean = name.replace(/\0/g, '').replace(/\.\./g, '').replace(/[\\/]/g, '').trim()
  if (!/^[a-zA-Z0-9._-]+$/.test(clean)) return null
  if (/^\.*$/.test(clean)) return null
  if (clean.length > 200) return null
  return clean
}

function sanitizeFileType(type: unknown): string | null {
  if (typeof type !== 'string') return null
  const t = type.toLowerCase().trim()
  return ALLOWED_FILE_TYPES.has(t) ? t : null
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  const { id } = await params
  if (!id) return fail(400, 'Order ID is required')
  const isValidId =
    /^[0-9]+$/.test(id) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  if (!isValidId) return fail(400, 'Invalid order ID')

  let fileName: string | null = null
  let fileType: string | null = null
  try {
    const body = await req.json()
    fileName = sanitizeFileName(body?.fileName)
    fileType = sanitizeFileType(body?.fileType)
  } catch {
    return fail(400, 'Invalid request body')
  }
  if (!fileName) return fail(400, 'Invalid fileName — use alphanumeric, hyphens, underscores, dots only')
  if (!fileType) return fail(400, 'Invalid fileType — allowed: image/jpeg, image/png, image/webp')

  let token = getToken(req)
  const refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  try {
    const user    = await sbAuth('/user', null, token!)
    const profile = await syncCustomerProfile(user)
    if (!profile) return fail(404, 'Profile not found')

    // Ownership check — same as the sibling /return route
    const rows = await sbAdmin(
      'GET',
      `/rest/v1/orders?id=eq.${id}&customer_id=eq.${profile.id}&select=id&limit=1`,
    ).catch(() => null)
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return fail(404, 'Order not found')
    }

    // Server-side feature gate — never trust the client to only call this
    // when the toggle is on; admin may have disabled it since the page loaded.
    const settingRows = await sbAdmin(
      'GET',
      `/rest/v1/site_settings?key=eq.return_photo_upload_enabled&select=value&limit=1`,
    ).catch(() => null)
    const enabled = Array.isArray(settingRows) && settingRows[0]?.value === 'true'
    if (!enabled) return fail(403, 'Photo upload is currently unavailable')

    // Cheap abuse guard — cap how many photos can accumulate under one
    // order's return, independent of whatever the client's own UI allows.
    const existingPhotoCount = await sbAdmin(
      'GET',
      `/rest/v1/returns?order_id=eq.${id}&select=photo_urls&order=created_at.desc&limit=1`,
    ).catch(() => null)
    const existingCount = Array.isArray(existingPhotoCount) && existingPhotoCount[0]?.photo_urls
      ? (existingPhotoCount[0].photo_urls as string[]).length
      : 0
    if (existingCount >= MAX_PHOTOS_PER_RETURN) {
      return fail(400, `Maximum ${MAX_PHOTOS_PER_RETURN} photos per return`)
    }

    // Namespaced path per order — keeps evidence photos organized and
    // prevents one customer's upload from colliding with another's.
    const path = `returns/${id}/${Date.now()}-${fileName}`

    const signRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`,
      {
        method:  'POST',
        headers: {
          'apikey':        SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ expiresIn: 300 }),
      },
    )
    if (!signRes.ok) {
      const err = await signRes.text()
      return fail(502, `Storage sign error: ${err}`)
    }
    // BUG FIX: the raw Storage REST API returns a single relative
    // `url` field with the token embedded as a query param —
    // { url: "/object/upload/sign/{bucket}/{path}?token=..." } — NOT
    // separate `signedURL`/`token` fields. Copied from pahadi-admin's
    // get_upload_url action, which has the identical bug; that code path
    // has apparently never been successfully exercised in production —
    // every real image in the bucket appears to have gone through admin's
    // OTHER (server-proxied) upload path instead.
    const { url: relativeSignedUrl } = await signRes.json()
    if (!relativeSignedUrl) return fail(502, 'Storage sign response missing url')
    const signedURL = `${SUPABASE_URL}/storage/v1${relativeSignedUrl}`
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`

    const res = ok({ success: true, signedURL, publicUrl })
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
    return res

  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    if (err.status === 401) return fail(401, 'Session expired — please login again')
    console.error('[return upload-url]', e)
    return fail(500, process.env.NODE_ENV === 'production' ? 'Upload URL request failed' : (err.message || 'Upload URL request failed'))
  }
}
