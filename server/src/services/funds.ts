import { getDb, withTransaction } from '../db.js'
import { HttpError } from '../lib/errors.js'
import { isValidDayKey } from '../lib/date.js'
import { getRoom, validateCurrency } from './rooms.js'
import { recomputeRoomBalances, shiftManualBalanceOnDay } from './balances.js'
import { convertCross, convertToUsd } from './rates/convert.js'
import type { Room } from './rooms.js'

export type TransactionType = 'deposit' | 'withdraw' | 'transfer' | 'casino'
export type Direction = 'in' | 'out'

const TRANSACTION_TYPES: TransactionType[] = ['deposit', 'withdraw', 'transfer', 'casino']
const DIRECTIONS: Direction[] = ['in', 'out']

export interface Transaction {
  id: number
  roomId: number
  roomName: string
  type: TransactionType
  amount: number
  fee: number
  currency: string
  direction: Direction
  counterpart: string | null
  destinationRoomId: number | null
  destinationRoomName: string | null
  date: string
  comment: string | null
  createdAt: string
  amountUsd: number | null
  /** System day-closing write-off (`recordCasinoPnl`): immutable. */
  writeoff: boolean
}

interface TxRow {
  id: number
  room_id: number
  type: TransactionType
  amount: number
  fee: number
  currency: string
  direction: Direction
  counterpart: string | null
  destination_room_id: number | null
  date: string
  comment: string | null
  created_at: string
  writeoff: number
  room_name: string
  destination_room_name: string | null
}

export interface TransactionInput {
  roomId: number
  type: TransactionType
  amount: number
  fee?: number
  currency: string
  direction?: Direction
  counterpart?: string | null
  destinationRoomId?: number | null
  date: string
  comment?: string | null
}

export interface TransactionFilters {
  type?: TransactionType
  roomId?: number
  currency?: string
  dateFrom?: string
  dateTo?: string
}

export interface FlowTotal {
  roomId: number
  currency: string
  direction: Direction
  total: number
}

function mapRow(r: TxRow): Transaction {
  return {
    id: r.id,
    roomId: r.room_id,
    roomName: r.room_name,
    type: r.type,
    amount: r.amount,
    fee: r.fee,
    currency: r.currency,
    direction: r.direction,
    counterpart: r.counterpart,
    destinationRoomId: r.destination_room_id,
    destinationRoomName: r.destination_room_name,
    date: r.date,
    comment: r.comment,
    createdAt: r.created_at,
    writeoff: r.writeoff === 1,
    amountUsd: convertToUsd(r.amount, r.currency, r.date, r.room_id)
  }
}

function validateString(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new HttpError(400, `${field}: must be a string`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw new HttpError(400, `${field}: must be at most ${max} characters`)
  return trimmed.length === 0 ? null : trimmed
}

export interface ValidatedTransaction {
  room: Room
  amount: number
  fee: number
  currency: string
  direction: Direction
  destinationRoom: Room | null
}

export function validateTransaction(input: TransactionInput): ValidatedTransaction {
  if (!TRANSACTION_TYPES.includes(input.type)) throw new HttpError(400, 'type: must be deposit, withdraw, transfer or casino')
  const isCasino = input.type === 'casino'
  if (!Number.isInteger(input.amount) || (isCasino ? input.amount === 0 : input.amount < 1)) {
    throw new HttpError(
      400,
      isCasino ? 'amount: must be a non-zero integer (min units)' : 'amount: must be a positive integer (min units)'
    )
  }
  const fee = input.fee ?? 0
  if (!Number.isInteger(fee) || fee < 0) throw new HttpError(400, 'fee: must be a non-negative integer (min units)')
  if (isCasino && fee !== 0) throw new HttpError(400, 'fee: must be 0 for casino')
  const currency = validateCurrency(input.currency, 'currency')
  // transfers always leave the sender room: direction is derived, never read
  // from the client (the "Куда" dropdown replaces the direction picker)
  // casino is a signed result: a win credits the room (in), a loss debits it (out)
  const direction: Direction =
    input.type === 'transfer' ? 'out' : isCasino ? (input.amount > 0 ? 'in' : 'out') : (input.direction ?? 'out')
  if (!DIRECTIONS.includes(direction)) throw new HttpError(400, 'direction: must be "in" or "out"')
  if (input.type === 'deposit' && direction !== 'in') throw new HttpError(400, 'deposit must have direction "in"')
  if (input.type === 'withdraw' && direction !== 'out') throw new HttpError(400, 'withdraw must have direction "out"')
  if (input.type !== 'transfer' && input.destinationRoomId != null) {
    throw new HttpError(400, 'destinationRoomId: only allowed for transfers')
  }
  if (!isValidDayKey(input.date)) throw new HttpError(400, 'date: must be a valid YYYY-MM-DD day')
  const room = getRoom(input.roomId)
  let destinationRoom: Room | null = null
  if (input.type === 'transfer') {
    if (!Number.isInteger(input.destinationRoomId) || (input.destinationRoomId as number) < 1) {
      throw new HttpError(400, 'destinationRoomId: required for a transfer')
    }
    if (input.destinationRoomId === room.id) throw new HttpError(400, 'destinationRoomId: cannot be the same as the source room')
    destinationRoom = getRoom(input.destinationRoomId as number)
  }
  return { room, amount: input.amount, fee, currency, direction, destinationRoom }
}

function recomputeRooms(...ids: (number | null)[]): void {
  const seen = new Set<number>()
  for (const id of ids) {
    if (id != null && !seen.has(id)) {
      seen.add(id)
      recomputeRoomBalances(id)
    }
  }
}

interface TransactionShape {
  roomId: number
  destinationRoomId: number | null
  type: TransactionType
  amount: number
  fee: number
  currency: string
  direction: Direction
  date: string
}

/**
 * Balance effect of a transaction on each moved balance, in the transaction's
 * own currency. Sender/source: casino is a signed result, a transfer pays
 * `amount + fee`, otherwise `in` credits `amount` and `out` debits
 * `amount + fee`. A transfer's receiving room is credited `amount`.
 */
function legsOf(tx: TransactionShape): { roomId: number; units: number }[] {
  const sourceUnits =
    tx.type === 'casino'
      ? tx.amount
      : tx.type === 'transfer'
        ? -(tx.amount + tx.fee)
        : tx.direction === 'in'
          ? tx.amount
          : -(tx.amount + tx.fee)
  const legs = [{ roomId: tx.roomId, units: sourceUnits }]
  if (tx.type === 'transfer' && tx.destinationRoomId != null) {
    legs.push({ roomId: tx.destinationRoomId, units: tx.amount })
  }
  return legs
}

/**
 * A day-closing write-off is a judgement about the day's data, not an event
 * that happened: `recordCasinoPnl` never applies balance legs (the measured
 * snapshot already contains the result). Editing or deleting such a row through
 * the ordinary transaction API would apply them anyway — the manual snapshot
 * would silently move and the day it closed would report itself as reconciled
 * while holding a wrong balance. The rows are immutable; a day is reopened by
 * recording a fresh balance snapshot for it in «Балансах».
 */
const WRITEOFF_IMMUTABLE =
  'Нельзя изменить системное списание: оно уже учтено в балансе за этот день. Чтобы открыть день заново, запиши снимок баланса за этот день в «Балансах».'

function assertMutable(tx: Transaction): void {
  if (tx.writeoff) throw new HttpError(400, WRITEOFF_IMMUTABLE)
}

/**
 * Applies (sign = 1) or reverses (sign = -1) a transaction on the manual
 * balance recorded on its own day. This is the "user re-entered the current
 * balance after the operation" emulation: a manual balance on a *different*
 * day is never touched, so past sessions keep reconciling.
 */
function applyBalanceLegs(tx: TransactionShape, sign: 1 | -1): void {
  for (const leg of legsOf(tx)) {
    shiftManualBalanceOnDay(leg.roomId, tx.date, sign * leg.units, tx.currency)
  }
}

export function createTransaction(raw: TransactionInput): Transaction {
  const v = validateTransaction(raw)
  const counterpart = validateString(raw.counterpart, 'counterpart', 80)
  const comment = validateString(raw.comment, 'comment', 500)

  let newId = 0
  withTransaction(() => {
    const info = getDb()
      .prepare(
        `INSERT INTO transactions (room_id, type, amount, fee, currency, direction, counterpart, destination_room_id, date, comment)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(v.room.id, raw.type, v.amount, v.fee, v.currency, v.direction, counterpart, v.destinationRoom?.id ?? null, raw.date, comment)
    newId = Number(info.lastInsertRowid)
    applyBalanceLegs(
      {
        roomId: v.room.id,
        destinationRoomId: v.destinationRoom?.id ?? null,
        type: raw.type,
        amount: v.amount,
        fee: v.fee,
        currency: v.currency,
        direction: v.direction,
        date: raw.date
      },
      1
    )
    recomputeRooms(v.room.id, v.destinationRoom?.id ?? null)
  })
  return getTransaction(newId)
}

/**
 * Records a casino result that the day's balance ALREADY reflects.
 *
 * `createTransaction` applies a transaction to the manual balance of its own day
 * (`applyBalanceLegs`): that emulates the user re-entering the balance after the
 * operation. A reconciliation write-off is the opposite case — it attributes a
 * delta the user has already measured (see `applyCasinoWriteoff`) — so applying
 * it would move the balance a second time and leave the day exactly as far from
 * reconciled. Hence no balance legs and no recompute: the row is pure P&L on a
 * day whose snapshot already contains it. The symmetry holds both ways: the row
 * carries `writeoff = 1` and is immutable afterwards (`assertMutable`) —
 * applying legs on edit/delete would move the snapshot it only documents.
 */
export function recordCasinoPnl(raw: TransactionInput): Transaction {
  if (raw.type !== 'casino') throw new HttpError(400, 'recordCasinoPnl: type must be casino')
  const v = validateTransaction(raw)
  const comment = validateString(raw.comment, 'comment', 500)
  return withTransaction(() => {
    const info = getDb()
      .prepare(
        `INSERT INTO transactions (room_id, type, amount, fee, currency, direction, comment, date, writeoff)
         VALUES (?, 'casino', ?, 0, ?, ?, ?, ?, 1)`
      )
      .run(v.room.id, v.amount, v.currency, v.direction, comment, raw.date)
    return getTransaction(Number(info.lastInsertRowid))
  })
}

export function getTransaction(id: number): Transaction {
  const row = getDb()
    .prepare(
      `SELECT t.*, r.name AS room_name, dr.name AS destination_room_name
       FROM transactions t
       JOIN rooms r ON r.id = t.room_id
       LEFT JOIN rooms dr ON dr.id = t.destination_room_id
       WHERE t.id = ?`
    )
    .get(id) as TxRow | undefined
  if (!row) throw new HttpError(404, 'Transaction not found')
  return mapRow(row)
}

export function updateTransaction(id: number, raw: TransactionInput): Transaction {
  const existing = getTransaction(id)
  assertMutable(existing)
  const v = validateTransaction(raw)
  const counterpart = validateString(raw.counterpart, 'counterpart', 80)
  const comment = validateString(raw.comment, 'comment', 500)
  withTransaction(() => {
    // reverse the old effect on its own day before rewriting the row
    applyBalanceLegs(existing, -1)
    getDb()
      .prepare(
        `UPDATE transactions
         SET room_id = ?, type = ?, amount = ?, fee = ?, currency = ?, direction = ?, counterpart = ?, destination_room_id = ?, date = ?, comment = ?
         WHERE id = ?`
      )
      .run(v.room.id, raw.type, v.amount, v.fee, v.currency, v.direction, counterpart, v.destinationRoom?.id ?? null, raw.date, comment, id)
    applyBalanceLegs(
      {
        roomId: v.room.id,
        destinationRoomId: v.destinationRoom?.id ?? null,
        type: raw.type,
        amount: v.amount,
        fee: v.fee,
        currency: v.currency,
        direction: v.direction,
        date: raw.date
      },
      1
    )
    recomputeRooms(existing.roomId, existing.destinationRoomId, v.room.id, v.destinationRoom?.id ?? null)
  })
  return getTransaction(id)
}

export function deleteTransaction(id: number): void {
  const tx = getTransaction(id)
  assertMutable(tx)
  withTransaction(() => {
    applyBalanceLegs(tx, -1)
    getDb().prepare('DELETE FROM transactions WHERE id = ?').run(id)
    recomputeRooms(tx.roomId, tx.destinationRoomId)
  })
}

export function listTransactions(filters: TransactionFilters = {}): Transaction[] {
  if (filters.dateFrom !== undefined && !isValidDayKey(filters.dateFrom)) throw new HttpError(400, 'dateFrom: invalid')
  if (filters.dateTo !== undefined && !isValidDayKey(filters.dateTo)) throw new HttpError(400, 'dateTo: invalid')

  const clauses: string[] = []
  const params: (string | number)[] = []
  if (filters.type) {
    clauses.push('t.type = ?')
    params.push(filters.type)
  }
  if (filters.roomId !== undefined) {
    clauses.push('t.room_id = ?')
    params.push(filters.roomId)
  }
  if (filters.currency) {
    clauses.push('t.currency = ?')
    params.push(filters.currency)
  }
  if (filters.dateFrom) {
    clauses.push('t.date >= ?')
    params.push(filters.dateFrom)
  }
  if (filters.dateTo) {
    clauses.push('t.date <= ?')
    params.push(filters.dateTo)
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = getDb()
    .prepare(
      `SELECT t.*, r.name AS room_name, dr.name AS destination_room_name
       FROM transactions t
       JOIN rooms r ON r.id = t.room_id
       LEFT JOIN rooms dr ON dr.id = t.destination_room_id
       ${where}
       ORDER BY t.date DESC, t.id DESC`
    )
    .all(...params) as unknown as TxRow[]
  return rows.map(mapRow)
}

/**
 * Per-room external fund flows for a date range (min units).
 * For outgoing movements the fee is part of what left the bankroll; for
 * incoming movements the fee is assumed paid outside the bankroll.
 * profit = delta_balance − (in − out), so these flows never affect profit.
 *
 * Transfers between own rooms produce two flow legs: the sender pays
 * `amount + fee` in its own currency, the receiver gets `amount` converted
 * into its cash currency at the day's frozen rate. Both legs cancel out of
 * profit, exactly like the balance deltas they generate.
 */
export function flowTotals(dateFrom: string, dateTo: string): FlowTotal[] {
  if (!isValidDayKey(dateFrom) || !isValidDayKey(dateTo)) throw new HttpError(400, 'flows: invalid date range')

  const rows = getDb()
    .prepare(
      `SELECT room_id, currency, direction,
              SUM(CASE WHEN direction = 'in' THEN amount ELSE amount + fee END) AS total
       FROM transactions
       WHERE date >= ? AND date <= ? AND type NOT IN ('transfer', 'casino')
       GROUP BY room_id, currency, direction`
    )
    .all(dateFrom, dateTo) as unknown as { room_id: number; currency: string; direction: Direction; total: number }[]

  const totals = new Map<string, FlowTotal>()
  const add = (roomId: number, currency: string, direction: Direction, amount: number) => {
    const key = `${roomId}:${currency}:${direction}`
    const current = totals.get(key)
    if (current) current.total += amount
    else totals.set(key, { roomId, currency, direction, total: amount })
  }
  for (const r of rows) add(r.room_id, r.currency, r.direction, r.total)

  const transfers = getDb()
    .prepare(
      `SELECT t.room_id, t.amount, t.fee, t.currency, t.date, t.destination_room_id, dr.cash_currency AS dest_currency
       FROM transactions t
       JOIN rooms dr ON dr.id = t.destination_room_id
       WHERE t.date >= ? AND t.date <= ? AND t.type = 'transfer'`
    )
    .all(dateFrom, dateTo) as unknown as {
    room_id: number
    amount: number
    fee: number
    currency: string
    date: string
    destination_room_id: number
    dest_currency: string
  }[]

  for (const tr of transfers) {
    add(tr.room_id, tr.currency, 'out', tr.amount + tr.fee)
    const converted = convertCross(tr.amount, tr.currency, tr.dest_currency, tr.date, tr.destination_room_id)
    if (converted !== null) add(tr.destination_room_id, tr.dest_currency, 'in', converted)
  }

  return [...totals.values()]
}