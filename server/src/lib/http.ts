import { HttpError } from './errors.js'

/**
 * Single gate for every id that reaches the services layer. Strings must be plain
 * decimal digits; numbers must be safe positive integers (a JSON body can carry one
 * directly); anything else — booleans, arrays, objects, null, NaN, Infinity, an id
 * past Number.MAX_SAFE_INTEGER that `Number()` would silently rewrite — is refused.
 * The result is always a safe positive integer.
 */
export function parseId(raw: string | number): number {
  if (typeof raw === 'string') {
    if (!/^\d+$/.test(raw)) throw new HttpError(400, 'Invalid id')
    const id = Number(raw)
    if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id')
    return id
  }
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw <= 0) throw new HttpError(400, 'Invalid id')
    return raw
  }
  throw new HttpError(400, 'Invalid id')
}
