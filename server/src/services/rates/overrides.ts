import { getDb } from '../../db.js'
import { HttpError } from '../../lib/errors.js'
import { getRoom, validateCurrency } from '../rooms.js'

export interface RateOverride {
  roomId: number
  fromCurrency: string
  toCurrency: string
  rate: number
  updatedAt: string
}

interface OverrideRow {
  room_id: number
  from_currency: string
  to_currency: string
  rate: number
  updated_at: string
}

function mapRow(r: OverrideRow): RateOverride {
  return {
    roomId: r.room_id,
    fromCurrency: r.from_currency,
    toCurrency: r.to_currency,
    rate: r.rate,
    updatedAt: r.updated_at
  }
}

/**
 * Manual per-room rate override. Takes precedence over any feed rate in all
 * conversions that know the room — e.g. the exact PokerOK cash-desk CNY/USD.
 * Rate semantics: `rate` units of `to` per 1 unit of `from` (RATE_SCALE-scaled).
 */
export function getRateOverrideScaled(roomId: number, from: string, to: string): number | null {
  const row = getDb()
    .prepare('SELECT rate FROM rate_overrides WHERE room_id = ? AND from_currency = ? AND to_currency = ?')
    .get(roomId, from, to) as { rate: number } | undefined
  return row ? row.rate : null
}

export function setRateOverride(roomId: number, from: string, to: string, rate: number): RateOverride {
  getRoom(roomId)
  const f = validateCurrency(from, 'fromCurrency')
  const t = validateCurrency(to, 'toCurrency')
  if (f === t) throw new HttpError(400, 'fromCurrency and toCurrency must differ')
  if (!Number.isInteger(rate) || rate <= 0) throw new HttpError(400, 'rate: must be a positive integer (scaled by 10000)')
  getDb()
    .prepare(
      `INSERT INTO rate_overrides (room_id, from_currency, to_currency, rate) VALUES (?, ?, ?, ?)
       ON CONFLICT(room_id, from_currency, to_currency)
       DO UPDATE SET rate = excluded.rate, updated_at = datetime('now')`
    )
    .run(roomId, f, t, rate)
  return requireOverride(roomId, f, t)
}

export function deleteRateOverride(roomId: number, from: string, to: string): void {
  getRoom(roomId)
  const f = validateCurrency(from, 'fromCurrency')
  const t = validateCurrency(to, 'toCurrency')
  getDb().prepare('DELETE FROM rate_overrides WHERE room_id = ? AND from_currency = ? AND to_currency = ?').run(roomId, f, t)
}

export function listOverrides(roomId?: number): RateOverride[] {
  const rows = (roomId === undefined
    ? getDb().prepare('SELECT * FROM rate_overrides ORDER BY room_id, from_currency, to_currency').all()
    : getDb().prepare('SELECT * FROM rate_overrides WHERE room_id = ? ORDER BY from_currency, to_currency').all(roomId)) as unknown as OverrideRow[]
  return rows.map(mapRow)
}

function requireOverride(roomId: number, from: string, to: string): RateOverride {
  const row = getDb()
    .prepare('SELECT * FROM rate_overrides WHERE room_id = ? AND from_currency = ? AND to_currency = ?')
    .get(roomId, from, to) as unknown as { room_id: number; from_currency: string; to_currency: string; rate: number; updated_at: string } | undefined
  if (!row) throw new Error('override disappeared right after upsert')
  return {
    roomId: row.room_id,
    fromCurrency: row.from_currency,
    toCurrency: row.to_currency,
    rate: row.rate,
    updatedAt: row.updated_at
  }
}