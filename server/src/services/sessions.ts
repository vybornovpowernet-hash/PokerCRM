import { HttpError } from '../lib/errors.js'
import { isValidDayKey } from '../lib/date.js'
import { getDb } from '../db.js'
import { getBalance, getBalanceBefore, flowsUsdRange, roomFlowsUsd } from './balances.js'
import { convertCross, convertToUsd, withRateCache } from './rates/convert.js'
import type { BalanceEntry, CashFlow } from './balances.js'

export interface RoomProfit {
  roomId: number
  roomName: string
  currency: string
  /** Where the day's balance came from: an absolute snapshot the user typed
   *  ('manual') or an interpolated carry-forward ('auto'). Reconciliation can
   *  only be trusted for 'manual' — see `computeReconcile`. */
  source: 'manual' | 'auto'
  delta: number
  flowInUsd: number
  flowOutUsd: number
  /** Balance-based session result: `delta − (in − out)`. Casino P&L is part
   *  of it (a casino row shifts the balance and is not an external flow). Kept
   *  as the reconcile input (`R = S − T − X`) — do not repurpose it. */
  profitUsd: number | null
  /** Signed casino P&L of the day in USD (0 when none) — the part of the
   *  balance delta that is gaming, not poker, shown for reference in «Сессии». */
  casinoUsd: number
  /** Pure poker result: `profitUsd − casinoUsd`. What the «Профит» column and
   *  the day/KPI totals display, so chips never masquerade as poker play. */
  pokerProfitUsd: number | null
  convertible: boolean
}

export interface SessionDay {
  date: string
  rooms: RoomProfit[]
  /** Pure-poker day total in USD (sum of `pokerProfitUsd`), null when no room is convertible. */
  totalUsd: number | null
}

const EMPTY_FLOW: CashFlow = { inUsd: 0, outUsd: 0, convertible: true }

/** Day profit of one room from an already-fetched previous balance and flows. */
function buildRoomProfit(entry: BalanceEntry, prev: BalanceEntry | null, flows: CashFlow, casinoUsd: number): RoomProfit {
  let prevAmount = prev ? prev.amount : 0
  if (prev && prev.currency !== entry.currency) {
    const converted = convertCross(prev.amount, prev.currency, entry.currency, entry.date, entry.roomId)
    if (converted === null) {
      prevAmount = prev.amount
    } else {
      prevAmount = converted
    }
  }
  const delta = entry.amount - prevAmount
  const deltaUsd = convertToUsd(delta, entry.currency, entry.date, entry.roomId)
  const convertible = deltaUsd !== null && flows.convertible
  const profitUsd = convertible ? deltaUsd - (flows.inUsd - flows.outUsd) : null
  return {
    roomId: entry.roomId,
    roomName: entry.roomName,
    currency: entry.currency,
    source: entry.source,
    delta,
    flowInUsd: flows.inUsd,
    flowOutUsd: flows.outUsd,
    profitUsd,
    casinoUsd,
    pokerProfitUsd: profitUsd !== null ? profitUsd - casinoUsd : null,
    convertible
  }
}

/** Signed casino P&L of a room on a day, converted to USD with that day's rate. */
function casinoUsdFor(roomId: number, date: string): number {
  const rows = getDb()
    .prepare("SELECT amount, currency FROM transactions WHERE type = 'casino' AND room_id = ? AND date = ?")
    .all(roomId, date) as unknown as { amount: number; currency: string }[]
  let total = 0
  for (const row of rows) {
    const usd = convertToUsd(row.amount, row.currency, date, roomId)
    if (usd !== null) total += usd
  }
  return total
}

/** Per-room day profit, all converted to USD. */
export function computeRoomProfit(entry: BalanceEntry): RoomProfit {
  const prev = getBalanceBefore(entry.roomId, entry.date)
  return buildRoomProfit(entry, prev, roomFlowsUsd(entry.roomId, entry.date), casinoUsdFor(entry.roomId, entry.date))
}

/** Session profit of a single room on a single day. */
export function sessionRoomProfit(roomId: number, date: string): RoomProfit | null {
  const entry = getBalance(roomId, date)
  if (!entry) return null
  return computeRoomProfit(entry)
}

/** Day profit per room: profit = delta_balance − (in − out), all converted to USD.
 *  Casino P&L is folded into `profitUsd` (reconcile input) and broken out as
 *  `casinoUsd` / `pokerProfitUsd` (the pure-poker figure the UI shows).
 *
 * A room is part of a session day only when it is actually a gaming day:
 *  - a MANUAL balance entry exists (source='manual'), or
 *  - tournaments were played that day, or
 *  - a casino transaction happened that day.
 * Auto-derived entries created by transactions alone do NOT make a session row:
 * a deposit/withdraw/transfer is bookkeeping, not play.
 *
 * Balances, tournaments and fund flows are fetched once for the whole range
 * (no per-day/per-room N+1); rate resolution is memoized for the pass.
 */
export function sessionsInRange(dateFrom: string, dateTo: string): SessionDay[] {
  if (!isValidDayKey(dateFrom) || !isValidDayKey(dateTo)) throw new HttpError(400, 'sessions: invalid date range')
  if (dateFrom > dateTo) throw new HttpError(400, 'sessions: dateFrom must be <= dateTo')

  return withRateCache(() => {
    const entries = getDb()
      .prepare(
        `SELECT b.room_id AS roomId, r.name AS roomName, b.date, b.amount, b.currency, b.source
         FROM balance_entries b JOIN rooms r ON r.id = b.room_id
         WHERE b.date >= ? AND b.date <= ?
         ORDER BY b.date, r.name`
      )
      .all(dateFrom, dateTo) as unknown as BalanceEntry[]

    const gaming = new Set(
      (getDb()
        .prepare('SELECT DISTINCT room_id, date FROM tournaments WHERE date >= ? AND date <= ?')
        .all(dateFrom, dateTo) as unknown as { room_id: number; date: string }[]).map((r) => `${r.room_id}:${r.date}`)
    )

    for (const r of getDb()
      .prepare('SELECT DISTINCT room_id, date FROM tournaments WHERE date >= ? AND date <= ?')
      .all(dateFrom, dateTo) as unknown as { room_id: number; date: string }[]) {
      gaming.add(`${r.room_id}:${r.date}`)
    }

    const flows = flowsUsdRange(dateFrom, dateTo)

    const casinoByKey = new Map<string, number>()
    for (const row of getDb()
      .prepare("SELECT room_id, date, amount, currency FROM transactions WHERE type = 'casino' AND date >= ? AND date <= ?")
      .all(dateFrom, dateTo) as unknown as { room_id: number; date: string; amount: number; currency: string }[]) {
      const key = `${row.room_id}:${row.date}`
      gaming.add(key)
      const usd = convertToUsd(row.amount, row.currency, row.date, row.room_id)
      if (usd === null) continue
      casinoByKey.set(key, (casinoByKey.get(key) ?? 0) + usd)
    }

    const beforeByRoom = new Map<number, BalanceEntry | null>()
    for (const roomId of new Set(entries.map((e) => e.roomId))) {
      beforeByRoom.set(roomId, getBalanceBefore(roomId, dateFrom))
    }

    const byDate = new Map<string, RoomProfit[]>()
    const lastByRoom = new Map<number, BalanceEntry>()
    for (const entry of entries) {
      const prev = lastByRoom.get(entry.roomId) ?? beforeByRoom.get(entry.roomId) ?? null
      lastByRoom.set(entry.roomId, entry)
      if (entry.source !== 'manual' && !gaming.has(`${entry.roomId}:${entry.date}`)) continue
      const flow = flows.get(`${entry.roomId}:${entry.date}`) ?? EMPTY_FLOW
      const profit = buildRoomProfit(entry, prev, flow, casinoByKey.get(`${entry.roomId}:${entry.date}`) ?? 0)
      const list = byDate.get(entry.date)
      if (list) list.push(profit)
      else byDate.set(entry.date, [profit])
    }

    const days: SessionDay[] = []
    for (const [date, rooms] of byDate) {
      const convertibleRooms = rooms.filter((r) => r.convertible)
      days.push({
        date,
        rooms,
        totalUsd: convertibleRooms.length > 0 ? convertibleRooms.reduce((acc, r) => acc + (r.pokerProfitUsd as number), 0) : null
      })
    }
    return days
  })
}
