import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HttpError } from '../src/lib/errors.js'
import { projectRoot } from '../src/db.js'
import * as uploadsModule from '../src/services/uploads.js'
import { DIARY_DIR, UPLOADS_ROOT, deleteDiaryImage, hasImageSignature, isDiaryImagePath, isSupportedImageMime, saveDiaryImage } from '../src/services/uploads.js'

const written: string[] = []

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
const GIF_HEADER = Buffer.from('GIF89a', 'latin1')
const WEBP_HEADER = Buffer.alloc(12)
WEBP_HEADER.write('RIFF', 0, 'latin1')
WEBP_HEADER.write('WEBP', 8, 'latin1')

afterEach(() => {
  for (const path of written.splice(0)) deleteDiaryImage(path)
})

describe('изоляция тестовых загрузок от боевого каталога', () => {
  const liveRoot = join(projectRoot, 'data', 'uploads')
  const liveDiary = join(liveRoot, 'diary')

  function rootResolver(): (env: Record<string, string | undefined>, fallback: string) => string {
    const fn = (uploadsModule as Record<string, unknown>).resolveUploadsRoot
    if (typeof fn !== 'function') {
      throw new Error('resolveUploadsRoot не экспортируется из services/uploads.ts')
    }
    return fn as (env: Record<string, string | undefined>, fallback: string) => string
  }

  it('resolveUploadsRoot: без VITEST оставляет боевой корень', () => {
    expect(rootResolver()({ POKER_CRM_UPLOADS_ROOT: join(tmpdir(), 'poker-crm-uploads-a') }, liveRoot)).toBe(liveRoot)
    expect(rootResolver()({}, liveRoot)).toBe(liveRoot)
  })

  it('resolveUploadsRoot: в тестовом режиме берёт абсолютный путь из окружения', () => {
    const forced = join(tmpdir(), 'poker-crm-uploads-b')
    expect(rootResolver()({ VITEST: 'true', POKER_CRM_UPLOADS_ROOT: forced }, liveRoot)).toBe(forced)
  })

  it('resolveUploadsRoot: в тестовом режиме без пути бросает, а не молчит', () => {
    expect(() => rootResolver()({ VITEST: 'true' }, liveRoot)).toThrow(/POKER_CRM_UPLOADS_ROOT/)
    expect(() => rootResolver()({ VITEST: 'true', POKER_CRM_UPLOADS_ROOT: '   ' }, liveRoot)).toThrow(/POKER_CRM_UPLOADS_ROOT/)
  })

  it('resolveUploadsRoot: относительный путь в тестовом режиме запрещён', () => {
    expect(() => rootResolver()({ VITEST: 'true', POKER_CRM_UPLOADS_ROOT: 'data/uploads' }, liveRoot)).toThrow(/абсолютн/)
  })

  it('боевой каталог под тестами не получает файлов, всё идёт в os.tmpdir', () => {
    const path = saveDiaryImage(PNG_HEADER, 'image/png')
    written.push(path)
    const name = path.slice('diary/'.length)

    // Точечная проверка конкретного имени, а не сравнение всего списка боевого
    // каталога: пользователь может сохранить запись с картинкой в живом
    // приложении прямо во время прогона, и «список не изменился» упало бы ложно.
    expect(UPLOADS_ROOT.startsWith(tmpdir())).toBe(true)
    expect(existsSync(join(UPLOADS_ROOT, path))).toBe(true)
    expect(existsSync(join(liveDiary, name))).toBe(false)
  })
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
    const path = saveDiaryImage(PNG_HEADER, 'image/png')
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

  it('recognises the magic bytes of every supported format', () => {
    expect(hasImageSignature('image/png', PNG_HEADER)).toBe(true)
    expect(hasImageSignature('image/jpeg', JPEG_HEADER)).toBe(true)
    expect(hasImageSignature('image/gif', GIF_HEADER)).toBe(true)
    expect(hasImageSignature('image/webp', WEBP_HEADER)).toBe(true)
    expect(hasImageSignature('image/png', WEBP_HEADER)).toBe(false)
    expect(hasImageSignature('image/jpeg', PNG_HEADER)).toBe(false)
    expect(hasImageSignature('image/gif', Buffer.from('GIF'))).toBe(false)
    expect(hasImageSignature('image/webp', Buffer.alloc(4))).toBe(false)
    expect(hasImageSignature('image/svg+xml', PNG_HEADER)).toBe(false)
  })

  it('rejects a payload whose bytes do not match the declared type', () => {
    expect(() => saveDiaryImage(Buffer.from('<svg onload=alert(1)>'), 'image/png')).toThrow(HttpError)
    expect(() => saveDiaryImage(PNG_HEADER, 'image/jpeg')).toThrow(HttpError)
    expect(() => saveDiaryImage(Buffer.from('RIFF....notwebp'), 'image/webp')).toThrow(HttpError)

    try {
      saveDiaryImage(Buffer.from('<svg onload=alert(1)>'), 'image/png')
      expect.unreachable('mismatched bytes must be rejected')
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError)
      expect((err as HttpError).status).toBe(400)
    }
  })

  it('writes a file whose extension matches the detected format', () => {
    const cases: [Buffer, string, string][] = [
      [PNG_HEADER, 'image/png', '.png'],
      [JPEG_HEADER, 'image/jpeg', '.jpg'],
      [GIF_HEADER, 'image/gif', '.gif'],
      [WEBP_HEADER, 'image/webp', '.webp']
    ]
    for (const [header, mime, ext] of cases) {
      const path = saveDiaryImage(header, mime)
      written.push(path)
      expect(path.endsWith(ext)).toBe(true)
      expect(existsSync(join(UPLOADS_ROOT, path))).toBe(true)
    }
  })
})
