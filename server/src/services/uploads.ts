import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { projectRoot } from '../db.js'
import { HttpError } from '../lib/errors.js'

export const UPLOADS_ROOT = join(projectRoot, 'data', 'uploads')
export const DIARY_DIR = join(UPLOADS_ROOT, 'diary')

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

const IMAGE_SIGNATURES: Record<string, (buffer: Buffer) => boolean> = {
  'image/png': (buffer) =>
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a,
  'image/jpeg': (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  'image/gif': (buffer) => buffer.length >= 4 && buffer.toString('latin1', 0, 4).startsWith('GIF8'),
  'image/webp': (buffer) =>
    buffer.length >= 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP'
}

const DIARY_PATH_PATTERN = /^diary\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|jpeg|webp|gif)$/

export function ensureUploadDirs(): void {
  mkdirSync(DIARY_DIR, { recursive: true })
}

export function isSupportedImageMime(mime: string | undefined): mime is string {
  return typeof mime === 'string' && mime in IMAGE_EXTENSIONS
}

export function hasImageSignature(mime: string, buffer: Buffer): boolean {
  const matches = IMAGE_SIGNATURES[mime]
  return matches !== undefined && matches(buffer)
}

export function isDiaryImagePath(value: unknown): value is string {
  return typeof value === 'string' && DIARY_PATH_PATTERN.test(value)
}

export function saveDiaryImage(buffer: Buffer, mime: string): string {
  const ext = IMAGE_EXTENSIONS[mime]
  if (!ext) throw new HttpError(400, 'file: unsupported image type')
  if (buffer.byteLength === 0) throw new HttpError(400, 'file: empty file')
  if (buffer.byteLength > MAX_IMAGE_BYTES) throw new HttpError(400, 'file: too large')
  if (!hasImageSignature(mime, buffer)) throw new HttpError(400, 'file: content does not match the declared image type')
  ensureUploadDirs()
  const name = `${randomUUID()}.${ext}`
  writeFileSync(join(DIARY_DIR, name), buffer)
  return `diary/${name}`
}

export function deleteDiaryImage(path: string): void {
  if (!isDiaryImagePath(path)) return
  try {
    rmSync(join(UPLOADS_ROOT, path), { force: true })
  } catch {
    // a missing file is not an error: the entry is what matters, the blob is a cache
  }
}
