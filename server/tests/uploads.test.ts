import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { HttpError } from '../src/lib/errors.js'
import { DIARY_DIR, UPLOADS_ROOT, deleteDiaryImage, isDiaryImagePath, isSupportedImageMime, saveDiaryImage } from '../src/services/uploads.js'

const written: string[] = []

afterEach(() => {
  for (const path of written.splice(0)) deleteDiaryImage(path)
})

describe('uploads service', () => {
  it('recognises supported image mime types', () => {
    expect(isSupportedImageMime('image/png')).toBe(true)
    expect(isSupportedImageMime('image/jpeg')).toBe(true)
    expect(isSupportedImageMime('image/webp')).toBe(true)
    expect(isSupportedImageMime('image/gif')).toBe(true)
    expect(isSupportedImageMime('image/svg+xml')).toBe(false)
    expect(isSupportedImageMime('text/html')).toBe(false)
    expect(isSupportedImageMime(undefined)).toBe(false)
  })

  it('accepts only well-formed diary paths', () => {
    expect(isDiaryImagePath('diary/2f9c1e7a-3b4d-4c5e-8f01-9a2b3c4d5e6f.png')).toBe(true)
    expect(isDiaryImagePath('diary/2f9c1e7a-3b4d-4c5e-8f01-9a2b3c4d5e6f.jpg')).toBe(true)
    expect(isDiaryImagePath('diary/../secret.png')).toBe(false)
    expect(isDiaryImagePath('/etc/passwd')).toBe(false)
    expect(isDiaryImagePath('diary/not-a-uuid.png')).toBe(false)
    expect(isDiaryImagePath(123)).toBe(false)
  })

  it('writes a diary image to disk and removes it again', () => {
    const path = saveDiaryImage(Buffer.from('fake-png-bytes'), 'image/png')
    written.push(path)
    expect(isDiaryImagePath(path)).toBe(true)
    expect(path.startsWith('diary/')).toBe(true)
    expect(path.endsWith('.png')).toBe(true)
    expect(existsSync(join(DIARY_DIR, path.slice('diary/'.length)))).toBe(true)

    deleteDiaryImage(path)
    written.pop()
    expect(existsSync(join(UPLOADS_ROOT, path))).toBe(false)
  })

  it('rejects unsupported, empty and oversized files', () => {
    expect(() => saveDiaryImage(Buffer.from('x'), 'image/svg+xml')).toThrow(HttpError)
    expect(() => saveDiaryImage(Buffer.alloc(0), 'image/png')).toThrow(HttpError)
    expect(() => saveDiaryImage(Buffer.alloc(10 * 1024 * 1024 + 1), 'image/png')).toThrow(HttpError)
  })
})
