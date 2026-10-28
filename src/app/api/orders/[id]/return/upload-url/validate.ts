// Pure validation helpers for POST /api/orders/[id]/return/upload-url (AUDIT S2-011).

export const ALLOWED_FILE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
// AUDIT S2-011: the 5 MB / image-only rules were client-side only. The server now requires the
// declared size, rejects anything over the cap or outside the image allow-list, requires the file
// extension to match the declared MIME, and pins the upload Content-Type + the returns/<order>/ path.
// The Storage signed-upload API has no per-URL size/MIME parameter, so the OWNER must also set the
// bucket's file_size_limit (5 MB) + allowed_mime_types, and (ideally) move return evidence to a
// PRIVATE bucket read via signed URLs — see the R5s report.
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
export const OBJECT_PREFIX = 'returns/'
const EXT_FOR_MIME: Record<string, RegExp> = {
  'image/jpeg': /\.(jpe?g)$/i,
  'image/png':  /\.png$/i,
  'image/webp': /\.webp$/i,
}

export function validateUploadRequest(body: unknown): { ok: true; fileName: string; fileType: string; fileSize: number } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>
  const fileName = sanitizeFileName(b.fileName)
  const fileType = sanitizeFileType(b.fileType)
  if (!fileName) return { ok: false, error: 'Invalid fileName — use alphanumeric, hyphens, underscores, dots only' }
  if (!fileType) return { ok: false, error: 'Invalid fileType — allowed: image/jpeg, image/png, image/webp' }
  if (!EXT_FOR_MIME[fileType].test(fileName)) return { ok: false, error: 'File extension does not match its type' }
  const size = typeof b.fileSize === 'number' ? b.fileSize : Number(b.fileSize)
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: 'fileSize is required' }
  if (size > MAX_UPLOAD_BYTES) return { ok: false, error: `File too large — maximum ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB` }
  return { ok: true, fileName, fileType, fileSize: Math.floor(size) }
}

/** The object key for an order's evidence photo — always under returns/<orderId>/ (no caller input in the prefix). */
export function buildObjectPath(orderId: string, fileName: string, now = Date.now()): string {
  const path = `${OBJECT_PREFIX}${orderId}/${now}-${fileName}`
  if (!path.startsWith(`${OBJECT_PREFIX}${orderId}/`) || path.includes('..') || path.includes('//')) {
    throw new Error('invalid object path')
  }
  return path
}

export function sanitizeFileName(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return null
  const clean = name.replace(/\0/g, '').replace(/\.\./g, '').replace(/[\\/]/g, '').trim()
  if (!/^[a-zA-Z0-9._-]+$/.test(clean)) return null
  if (/^\.*$/.test(clean)) return null
  if (clean.length > 200) return null
  return clean
}

export function sanitizeFileType(type: unknown): string | null {
  if (typeof type !== 'string') return null
  const t = type.toLowerCase().trim()
  return ALLOWED_FILE_TYPES.has(t) ? t : null
}

