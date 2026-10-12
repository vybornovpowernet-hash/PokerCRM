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

const DIARY_PATH_PATTERN = /^diary\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|jpeg|webp|gif)$/

export function ensureUploadDirs(): void {
  mkdirSync(DIARY_DIR, { recursive: true })
}

export function isSupportedImageMime(mime: string | undefined): mime is string {
  return typeof mime === 'string' && mime in IMAGE_EXTENSIONS
}

export function isDiaryImagePath(value: unknown): value is string {
  return typeof value === 'string' && DIARY_PATH_PATTERN.test(value)
}

export function saveDiaryImage(buffer: Buffer, mime: string): string {
  const ext = IMAGE_EXTENSIONS[mime]
  if (!ext) throw new HttpError(400, 'file: unsupported image type')
  if (buffer.byteLength === 0) throw new HttpError(400, 'file: empty file')
  if (buffer.byteLength > MAX_IMAGE_BYTES) throw new HttpError(400, 'file: too large')
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
