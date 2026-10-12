import { getDb, withTransaction } from '../db.js'
import { HttpError } from '../lib/errors.js'
import { isValidDayKey } from '../lib/date.js'
import { getRoom, validateCurrency } from './rooms.js'
import { convertCross, convertToUsd } from './rates/convert.js'
import { reconcilePendingImports } from './pending.js'

export interface BalanceEntry {
  roomId: number
  roomName: string
  date: string
  amount: number
  currency: string
  source: 'manual' | 'auto'
}

interface BalanceRow {
  room_id: number
  room_name: string
  date: string
  amount: number
  currency: string
  source: 'manual' | 'auto'
}

function mapRow(r: BalanceRow): BalanceEntry {
  return {
    roomId: r.room_id,
    roomName: r.room_name,
    date: r.date,
    amount: r.amount,
    currency: r.currency,
    source: r.source
  }
}

export function upsertBalance(roomId: number, date: string, amount: number, currency: string): BalanceEntry {
  if (!Number.isInteger(amount) || amount < 0) throw new HttpError(400, 'amount: must be a non-negative integer (min units)')
  if (!isValidDayKey(date)) throw new HttpError(400, 'date: must be a valid YYYY-MM-DD day')
  const room = getRoom(roomId)
  const ccy = validateCurrency(currency, 'currency')
  withTransaction(() => {
    getDb()
      .prepare(
        `INSERT INTO balance_entries (room_id, date, amount, currency, source)
         VALUES (?, ?, ?, ?, 'manual')
         ON CONFLICT(room_id, date) DO UPDATE SET
           amount = excluded.amount, currency = excluded.currency, source = 'manual'`
      )
      .run(roomId, date, amount, ccy)
    reconcilePendingImports(roomId)
  })
  return mapRow(requireRow(roomId, date, room.name))
}

function requireRow(roomId: number, date: string, roomName: string): BalanceRow {
  return {
    room_id: roomId,
    room_name: roomName,
    date,
    amount: entryAmount(roomId, date),
    currency: entryCurrency(roomId, date),
    source: entrySource(roomId, date)
  }
}

function entryAmount(roomId: number, date: string): number {
  const row = getDb().prepare('SELECT amount FROM balance_entries WHERE room_id = ? AND date = ?').get(roomId, date) as { amount: number } | undefined
  if (!row) throw new HttpError(404, 'Balance entry not found')
  return row.amount
}

function entryCurrency(roomId: number, date: string): string {
  const row = getDb().prepare('SELECT currency FROM balance_entries WHERE room_id = ? AND date = ?').get(roomId, date) as
    | { currency: string }
    | undefined
  if (!row) throw new HttpError(404, 'Balance entry not found')
  return row.currency
}

function entrySource(roomId: number, date: string): 'manual' | 'auto' {
  const row = getDb().prepare('SELECT source FROM balance_entries WHERE room_id = ? AND date = ?').get(roomId, date) as
    | { source: 'manual' | 'auto' }
    | undefined
  if (!row) throw new HttpError(404, 'Balance entry not found')
  return row.source
}

/** Balance of a room exactly on a day. */
export function getBalance(roomId: number, date: string): BalanceEntry | null {
  const row = getDb()
    .prepare(
      `SELECT b.room_id, r.name AS room_name, b.date, b.amount, b.currency, b.source
       FROM balance_entries b JOIN rooms r ON r.id = b.room_id
       WHERE b.room_id = ? AND b.date = ?`
    )
    .get(roomId, date) as BalanceRow | undefined
  return row ? mapRow(row) : null
}

/** Latest balance recorded strictly before a day. */
export function getBalanceBefore(roomId: number, date: string): BalanceEntry | null {
  const row = getDb()
    .prepare(
      `SELECT b.room_id, r.name AS room_name, b.date, b.amount, b.currency, b.source
       FROM balance_entries b JOIN rooms r ON r.id = b.room_id
       WHERE b.room_id = ? AND b.date < ?
       ORDER BY b.date DESC LIMIT 1`
    )
    .get(roomId, date) as BalanceRow | undefined
  return row ? mapRow(row) : null
}

/** Latest balance for every room that has any entry. */
export function getLatestBalances(): BalanceEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT b.room_id, r.name AS room_name, b.date, b.amount, b.currency, b.source
       FROM balance_entries b
       JOIN rooms r ON r.id = b.room_id
       JOIN (SELECT room_id, MAX(date) AS max_date FROM balance_entries GROUP BY room_id) latest
         ON latest.room_id = b.room_id AND latest.max_date = b.date
       ORDER BY r.name`
    )
    .all() as unknown as BalanceRow[]
  return rows.map(mapRow)
}

/** All room balances recorded exactly on a day. */
export function listForDate(date: string): BalanceEntry[] {
  if (!isValidDayKey(date)) throw new HttpError(400, 'date: must be a valid YYYY-MM-DD day')
  const rows = getDb()
    .prepare(
      `SELECT b.room_id, r.name AS room_name, b.date, b.amount, b.currency, b.source
       FROM balance_entries b JOIN rooms r ON r.id = b.room_id
       WHERE b.date = ? ORDER BY r.name`
    )
    .all(date) as unknown as BalanceRow[]
  return rows.map(mapRow)
}

export interface CashFlow {
  inUsd: number
  outUsd: number
  convertible: boolean
}

const EMPTY_FLOW: CashFlow = { inUsd: 0, outUsd: 0, convertible: true }

/**
 * External fund flows for a whole date range, keyed by `"roomId:date"`.
 *
 * One pass over `transactions` (plain + transfer sender legs + transfer receiver
 * legs) instead of per-day `roomFlowsUsd` calls, so `sessionsInRange` no longer
 * runs an N+1 query per day/room. Days without transactions simply have no key.
 * Casino rows are gaming P&L, not external flows, so they are skipped here.
 */
export function flowsUsdRange(dateFrom: string, dateTo: string, roomIds?: number[]): Map<string, CashFlow> {
  const db = getDb()
  const map = new Map<string, CashFlow>()
  const bucket = (roomId: number, date: string): CashFlow => {
    const key = `${roomId}:${date}`
    let flow = map.get(key)
    if (!flow) {
      flow = { inUsd: 0, outUsd: 0, convertible: true }
      map.set(key, flow)
    }
    return flow
  }

  const cashCurrency = new Map<number, string>()
  for (const row of db.prepare('SELECT id, cash_currency FROM rooms').all() as unknown as { id: number; cash_currency: string }[]) {
    cashCurrency.set(row.id, row.cash_currency)
  }

  const roomFilter = roomIds && roomIds.length > 0 ? ` AND room_id IN (${roomIds.map(() => '?').join(',')})` : ''
  const destFilter = roomIds && roomIds.length > 0 ? ` AND destination_room_id IN (${roomIds.map(() => '?').join(',')})` : ''
  const rangeParams: (string | number)[] = [dateFrom, dateTo]

  const plain = db
    .prepare(
      `SELECT room_id, date, amount, fee, currency, direction FROM transactions
       WHERE date >= ? AND date <= ? AND type NOT IN ('transfer', 'casino')${roomFilter}`
    )
    .all(...rangeParams, ...(roomIds ?? [])) as unknown as {
    room_id: number
    date: string
    amount: number
    fee: number
    currency: string
    direction: 'in' | 'out'
  }[]
  for (const row of plain) {
    const flow = bucket(row.room_id, row.date)
    const value = convertToUsd(row.direction === 'in' ? row.amount : row.amount + row.fee, row.currency, row.date, row.room_id)
    if (value === null) {
      flow.convertible = false
      continue
    }
    if (row.direction === 'in') flow.inUsd += value
    else flow.outUsd += value
  }

  const outgoing = db
    .prepare(
      `SELECT room_id, date, amount, fee, currency FROM transactions
       WHERE date >= ? AND date <= ? AND type = 'transfer'${roomFilter}`
    )
    .all(...rangeParams, ...(roomIds ?? [])) as unknown as { room_id: number; date: string; amount: number; fee: number; currency: string }[]
  for (const row of outgoing) {
    const flow = bucket(row.room_id, row.date)
    const value = convertToUsd(row.amount + row.fee, row.currency, row.date, row.room_id)
    if (value === null) {
      flow.convertible = false
      continue
    }
    flow.outUsd += value
  }

  const incoming = db
    .prepare(
      `SELECT destination_room_id AS room_id, date, amount, currency FROM transactions
       WHERE date >= ? AND date <= ? AND type = 'transfer' AND destination_room_id IS NOT NULL${destFilter}`
    )
    .all(...rangeParams, ...(roomIds ?? [])) as unknown as { room_id: number; date: string; amount: number; currency: string }[]
  for (const row of incoming) {
    const flow = bucket(row.room_id, row.date)
    const cash = cashCurrency.get(row.room_id)
    if (cash === undefined) {
      flow.convertible = false
      continue
    }
    const destAmount = convertCross(row.amount, row.currency, cash, row.date, row.room_id)
    if (destAmount === null) {
      flow.convertible = false
      continue
    }
    const value = convertToUsd(destAmount, cash, row.date, row.room_id)
    if (value === null) {
      flow.convertible = false
      continue
    }
    flow.inUsd += value
  }

  return map
}

/** External fund flows of a room on a day, converted to USD with that day's rates. */
export function roomFlowsUsd(roomId: number, date: string): CashFlow {
  getRoom(roomId)
  return flowsUsdRange(date, date, [roomId]).get(`${roomId}:${date}`) ?? EMPTY_FLOW
}

export function totalCurrentUsd(): number | null {
  const balances = getLatestBalances()
  let total = 0
  for (const b of balances) {
    const usd = convertToUsd(b.amount, b.currency, b.date, b.roomId)
    if (usd === null) return null
    total += usd
  }
  return total
}

interface ManualRow {
  date: string
  amount: number
  currency: string
}

interface TxRow {
  id: number
  date: string
  amount: number
  fee: number
  currency: string
  direction: 'in' | 'out'
  type: 'deposit' | 'withdraw' | 'transfer' | 'casino'
  destination_room_id: number | null
}

/**
 * Balance effect of one transaction on a room, in `targetCurrency`, for the
 * given day. The transfer receiving leg credits `amount` (in the sender's
 * currency) with no fee; casino is a signed gaming result added verbatim; every
 * other row moves `amount` (in) or `-(amount + fee)` (out).
 */
function transactionEffect(
  t: TxRow,
  roomId: number,
  targetCurrency: string,
  date: string
): number | null {
  const recipientLeg = t.type === 'transfer' && t.destination_room_id === roomId
  const units = recipientLeg
    ? t.amount
    : t.type === 'casino'
      ? t.amount
      : t.direction === 'in'
        ? t.amount
        : -(t.amount + t.fee)
  return convertCross(units, t.currency, targetCurrency, date, roomId)
}

/**
 * One-off shift of the manual balance recorded exactly on `date`, applied at
 * the moment a transaction is written. It emulates the user re-entering the
 * room balance after the operation: the stored `amount` becomes the new truth,
 * so `recomputeRoomBalances` (which never touches manual entries) keeps it.
 *
 * Auto entries are deliberately not shifted: when the transaction has no
 * same-day manual anchor the derived chain already reflects it, and shifting
 * would double count.
 */
export function shiftManualBalanceOnDay(roomId: number, date: string, effectUnits: number, currency: string): void {
  if (effectUnits === 0) return
  const db = getDb()
  const row = db
    .prepare("SELECT currency FROM balance_entries WHERE room_id = ? AND date = ? AND source = 'manual'")
    .get(roomId, date) as { currency: string } | undefined
  if (!row) return
  const converted = convertCross(effectUnits, currency, row.currency, date, roomId)
  if (converted === null) return
  db.prepare("UPDATE balance_entries SET amount = amount + ? WHERE room_id = ? AND date = ? AND source = 'manual'").run(
    converted,
    roomId,
    date
  )
}

/** Rebuilds the derived auto chain of every room (used at startup after migrations). */
export function recomputeAllBalances(): void {
  const rooms = getDb().prepare('SELECT id FROM rooms').all() as unknown as { id: number }[]
  for (const room of rooms) recomputeRoomBalances(room.id)
}

/**
 * Re-derives the auto-derived balance chain of a room from its manual anchors
 * and its transactions. Called after every transaction write.
 *
 * A manual entry is an ABSOLUTE snapshot: its stored `amount` is the source of
 * truth and is never recomputed here. Auto entries are created on transaction
 * *and tournament* dates that have no manual anchor, carried from the previous
 * anchor (or from zero) plus that day's transaction effects; tournament days
 * get an interpolated carry-forward value so a missing balance still reconciles
 * against the saved tournaments.
 *
 * The "a transaction moves the balance" behaviour lives in `funds.ts`: on each
 * write it calls `shiftManualBalanceOnDay`, which adds the effect to the manual
 * entry recorded on the very same day. Manual entries on other days are
 * untouched, so historical sessions keep reconciling.
 */
export function recomputeRoomBalances(roomId: number): void {
  withTransaction(() => {
    const db = getDb()
    const room = getRoom(roomId)
    db.prepare("DELETE FROM balance_entries WHERE room_id = ? AND source = 'auto'").run(roomId)

    const manuals = db
      .prepare(
        `SELECT date, amount, currency
         FROM balance_entries WHERE room_id = ? AND source = 'manual' ORDER BY date`
      )
      .all(roomId) as unknown as ManualRow[]

    const txns = db
      .prepare(
        `SELECT id, date, amount, fee, currency, direction, type, destination_room_id
         FROM transactions WHERE room_id = ? OR destination_room_id = ?
         ORDER BY date, id`
      )
      .all(roomId, roomId) as unknown as TxRow[]

    const tournamentDates = new Set(
      (db.prepare('SELECT DISTINCT date FROM tournaments WHERE room_id = ?').all(roomId) as unknown as { date: string }[]).map((r) => r.date)
    )

    const dates = Array.from(
      new Set([...manuals.map((m) => m.date), ...txns.map((t) => t.date), ...tournamentDates]).values()
    ).sort()

    const upsertAuto = db.prepare(
      `INSERT INTO balance_entries (room_id, date, amount, currency, source) VALUES (?, ?, ?, ?, 'auto')
       ON CONFLICT(room_id, date) DO UPDATE SET amount = excluded.amount, currency = excluded.currency, source = 'auto'`
    )
    let manualIdx = 0
    let carry = 0
    let carryCurrency: string | null = null

    for (const date of dates) {
      const next = manualIdx < manuals.length ? manuals[manualIdx] : null
      const manual = next && next.date === date ? next : null
      const dayTxns = txns.filter((t) => t.date === date)

      if (manual) {
        carry = manual.amount
        carryCurrency = manual.currency
        manualIdx++
        continue
      }

      const isTournamentDate = tournamentDates.has(date)
      if (dayTxns.length === 0 && !isTournamentDate) continue
      if (carryCurrency === null) carryCurrency = room.cashCurrency

      let added = 0
      for (const t of dayTxns) {
        const converted = transactionEffect(t, roomId, carryCurrency, date)
        if (converted !== null) added += converted
      }

      upsertAuto.run(roomId, date, carry + added, carryCurrency)
      carry += added
    }
  })
}