import { getDb, withTransaction } from '../db.js'
import { DEFAULT_COLOR, validateColor } from '../lib/color.js'
import { HttpError } from '../lib/errors.js'
import { reconcilePendingImports } from './pending.js'

export interface Room {
  id: number
  name: string
  cashCurrency: string
  tournamentCurrency: string
  rateSource: string | null
  color: string
  isWallet: boolean
  createdAt: string
}

interface RoomRow {
  id: number
  name: string
  cash_currency: string
  tournament_currency: string
  rate_source: string | null
  color: string
  is_wallet: number
  created_at: string
}

export const ROOM_RATE_SOURCES = ['pokerdom', 'er-api'] as const
export const DEFAULT_ROOM_COLOR = DEFAULT_COLOR
export { validateColor }

function mapRow(r: RoomRow): Room {
  return {
    id: r.id,
    name: r.name,
    cashCurrency: r.cash_currency,
    tournamentCurrency: r.tournament_currency,
    rateSource: r.rate_source,
    color: r.color,
    isWallet: r.is_wallet === 1,
    createdAt: r.created_at
  }
}

export function validateIsWallet(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'boolean') return value
  if (value === 0 || value === 1) return value === 1
  throw new HttpError(400, 'isWallet: must be a boolean')
}

export function validateCurrency(value: string, field: string): string {
  const v = value.trim().toUpperCase()
  if (!['RUB', 'USD', 'EUR', 'CNY'].includes(v)) {
    throw new HttpError(400, `${field}: must be one of RUB, USD, EUR or CNY`)
  }
  return v
}

export function validateRateSource(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (!ROOM_RATE_SOURCES.includes(value as (typeof ROOM_RATE_SOURCES)[number])) {
    throw new HttpError(400, 'rateSource: must be pokerdom or er-api')
  }
  return value as string
}

export function validateName(value: string): string {
  const v = value.trim()
  if (v.length < 1 || v.length > 80) {
    throw new HttpError(400, 'name: must be 1-80 characters')
  }
  return v
}

export function listRooms(): Room[] {
  const rows = getDb().prepare('SELECT * FROM rooms ORDER BY name').all() as unknown as RoomRow[]
  return rows.map(mapRow)
}

export function getRoom(id: number): Room {
  const row = getDb().prepare('SELECT * FROM rooms WHERE id = ?').get(id) as RoomRow | undefined
  if (!row) throw new HttpError(404, 'Room not found')
  return mapRow(row)
}

export function createRoom(input: {
  name: string
  cashCurrency: string
  tournamentCurrency: string
  rateSource?: string | null
  color?: string
  isWallet?: boolean
}): Room {
  const name = validateName(input.name)
  const cashCurrency = validateCurrency(input.cashCurrency, 'cashCurrency')
  const tournamentCurrency = validateCurrency(input.tournamentCurrency, 'tournamentCurrency')
  const rateSource = validateRateSource(input.rateSource)
  const color = validateColor(input.color)
  const isWallet = validateIsWallet(input.isWallet)

  try {
    const info = getDb()
      .prepare('INSERT INTO rooms (name, cash_currency, tournament_currency, rate_source, color, is_wallet) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, cashCurrency, tournamentCurrency, rateSource, color, isWallet ? 1 : 0)
    return getRoom(Number(info.lastInsertRowid))
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, 'Room with this name already exists')
    throw err
  }
}

export function updateRoom(
  id: number,
  input: {
    name?: string
    cashCurrency?: string
    tournamentCurrency?: string
    rateSource?: string | null
    color?: string
    isWallet?: boolean
  }
): Room {
  getRoom(id)
  const current = getRoom(id)
  const name = input.name !== undefined ? validateName(input.name) : current.name
  const cashCurrency = input.cashCurrency !== undefined ? validateCurrency(input.cashCurrency, 'cashCurrency') : current.cashCurrency
  const tournamentCurrency =
    input.tournamentCurrency !== undefined ? validateCurrency(input.tournamentCurrency, 'tournamentCurrency') : current.tournamentCurrency
  const rateSource = input.rateSource !== undefined ? validateRateSource(input.rateSource) : current.rateSource
  const color = input.color !== undefined ? validateColor(input.color) : current.color
  const isWallet = input.isWallet !== undefined ? validateIsWallet(input.isWallet) : current.isWallet

  try {
    withTransaction(() => {
      getDb()
        .prepare('UPDATE rooms SET name = ?, cash_currency = ?, tournament_currency = ?, rate_source = ?, color = ?, is_wallet = ? WHERE id = ?')
        .run(name, cashCurrency, tournamentCurrency, rateSource, color, isWallet ? 1 : 0, id)
      reconcilePendingImports(id)
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, 'Room with this name already exists')
    throw err
  }
  return getRoom(id)
}

export function deleteRoom(id: number): void {
  getRoom(id)
  getDb().prepare('DELETE FROM rooms WHERE id = ?').run(id)
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    ('errcode' in err ? (err as { errcode?: number }).errcode === 2067 : false) // SQLITE_CONSTRAINT_UNIQUE
  )
}