/** AUDIT S2-011: size / MIME / extension / path rules for return-photo signed uploads. */
import { describe, it, expect } from 'vitest'
import { validateUploadRequest, buildObjectPath, MAX_UPLOAD_BYTES } from '@/app/api/orders/[id]/return/upload-url/validate'

describe('validateUploadRequest', () => {
  it('accepts a 2 MB jpeg', () => {
    expect(validateUploadRequest({ fileName: 'a.jpg', fileType: 'image/jpeg', fileSize: 2 * 1024 * 1024 })).toMatchObject({ ok: true, fileType: 'image/jpeg' })
  })
  it('rejects > 5 MB', () => {
    const r = validateUploadRequest({ fileName: 'a.jpg', fileType: 'image/jpeg', fileSize: MAX_UPLOAD_BYTES + 1 })
    expect(r.ok).toBe(false); expect(r.ok === false && r.error).toMatch(/too large/i)
  })
  it('rejects a missing size (the old behaviour had no server-side size check at all)', () => {
    expect(validateUploadRequest({ fileName: 'a.jpg', fileType: 'image/jpeg' }).ok).toBe(false)
  })
  it('rejects non-image MIME (text/html, image/svg+xml) and MIME/extension mismatch', () => {
    expect(validateUploadRequest({ fileName: 'a.html', fileType: 'text/html', fileSize: 10 }).ok).toBe(false)
    expect(validateUploadRequest({ fileName: 'a.svg', fileType: 'image/svg+xml', fileSize: 10 }).ok).toBe(false)
    expect(validateUploadRequest({ fileName: 'a.html', fileType: 'image/jpeg', fileSize: 10 }).ok).toBe(false)
  })
  it('object path is always under returns/<orderId>/ with no traversal', () => {
    expect(buildObjectPath('42', 'a.jpg', 1)).toBe('returns/42/1-a.jpg')
    expect(() => buildObjectPath('42', '../x.jpg')).toThrow()
  })
})
