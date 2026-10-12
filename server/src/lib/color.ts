import { HttpError } from './errors.js'

export const DEFAULT_COLOR = '#f1f5f9'

export function validateColor(value: unknown, field = 'color'): string {
  if (value === undefined || value === null || value === '') return DEFAULT_COLOR
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.trim())) {
    throw new HttpError(400, `${field}: must be a hex color like #f1f5f9`)
  }
  return value.trim().toLowerCase()
}
