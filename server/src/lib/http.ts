import { HttpError } from './errors.js'

export function parseId(raw: string | number): number {
  if (typeof raw === 'string' && !/^\d+$/.test(raw)) throw new HttpError(400, 'Invalid id')
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id')
  return id
}