import { HttpError } from '../lib/errors.js'
import { isValidDayKey } from '../lib/date.js'
import { withRateCache } from './rates/convert.js'
import { listTransactions, transferFxBucket, transactionsTotals } from './funds.js'
import type { TransactionType, WriteoffReason } from './funds.js'

/**
 * «Куда уходят деньги»: server-side aggregation for the widget on the
 * «Транзакции» page. Everything is USD in integer min units, computed from the
 * ledger rows of one independent period; the client only displays it.
 *
 * Deliberate accounting choices:
 * - A transfer is never money leaving or entering the network, so transfers are
 *   absent from `cash`; the widget answers "where did the money go", and the
 *   answer is fees, casino and rate differences.
 * - `netInUsd` is deposits minus withdrawals WITHOUT subtracting fees: the fee
 *   of an outgoing operation is already inside what left the room, so subtracting
 *   it again would charge the user twice. Fees are their own, additive block.
 * - A day-closing write-off whose reason is `fx` is NOT the rate difference:
 *   one is an unexplained residual of a balance snapshot, the other is a
 *   computed cash-desk vs. feed spread. They live in different blocks and are
 *   never summed together.
 * - `null` always means "no rate" and is counted in `missingRateRows`; it is
 *   never folded into 0, so an incomplete total is visible as incomplete.
 */

export interface OverviewPeriod {
  dateFrom: string
  dateTo: string
}

export interface SumCount {
  usd: number
  count: number
}

export interface OverviewCash {
  depositedUsd: number
  withdrawnUsd: number
  netInUsd: number
  missingRateRows: number
}

export interface OverviewFeeRoom {
  roomId: number
  name: string
  usd: number
  count: number
}

export type OverviewFeeType = Extract<TransactionType, 'deposit' | 'withdraw' | 'transfer'>

export interface OverviewFees {
  totalUsd: number
  rows: number
  missingRateRows: number
  byType: Record<OverviewFeeType, SumCount>
  /** Raw min units per currency — never summed across currencies. */
  byCurrency: Record<string, number>
  byRoom: OverviewFeeRoom[]
}

export interface OverviewCasino {
  totalUsd: number
  winsUsd: number
  lossesUsd: number
  /** Rows the user wrote by hand (`writeoff = 0`). */
  manualUsd: number
  /** System day-closing write-offs (`writeoff = 1`). */
  autoUsd: number
  rows: number
  missingRateRows: number
  byReason: Record<WriteoffReason, SumCount>
}

export interface OverviewFxExcluded {
  noDestAmount: number
  sameCurrency: number
  noRate: number
}

export interface OverviewFx {
  /** Non-negative magnitude of transfers that credited less than the program's rate. */
  lossesUsd: number
  /** Non-negative magnitude of transfers that credited more than the program's rate. */
  gainsUsd: number
  /** `lossesUsd - gainsUsd`: what the user lost on the spread, net. */
  netLossUsd: number
  rows: number
  excluded: OverviewFxExcluded
}

export interface OverviewRoom {
  roomId: number
  name: string
  depositedUsd: number
  withdrawnUsd: number
  feesUsd: number
  casinoUsd: number
  /** Rate difference attributed to the RECEIVING room: the spread is paid where the money landed. */
  fxUsd: number
  /** Combined cost of this room: `feesUsd + fxUsd`. Summed over rooms it equals `costs.totalUsd`. */
  costsUsd: number
  transfersOut: number
  transfersIn: number
}

export interface OverviewRoute {
  fromRoomId: number
  fromRoomName: string
  toRoomId: number | null
  toRoomName: string
  count: number
  feeUsd: number
  /** Sum of `fxDiffUsd` of the route's transfers where the difference could be computed; 0 where it could not. */
  fxUsd: number
  /** Combined cost of this route: `feeUsd + fxUsd`. */
  costsUsd: number
  /** Raw min units per fee currency, including routes that paid no fee. */
  feeByCurrency: Record<string, number>
}

/**
 * «Комиссии» как одна сущность: сколько рум взял с пользователя — и явную комиссию,
 * и курсовой спред на зачислении перевода. Выигрыш на курсе (отрицательная разница)
 * уменьшает сумму. Списания `casino` с причиной `fx` сюда НЕ входят: это остаток дня,
 * а не удержанный румом процент, и он живёт в блоке `casino`.
 */
export interface OverviewCosts {
  totalUsd: number
  feesUsd: number
  fxNetLossUsd: number
  fxLossesUsd: number
  fxGainsUsd: number
  missingRateRows: number
  /** Кросс-валютные переводы, где курсовую разницу посчитать нельзя: нет точной суммы либо нет курса. */
  fxNotCountedTransfers: number
}

export interface MoneyOverview {
  period: OverviewPeriod
  cash: OverviewCash
  fees: OverviewFees
  casino: OverviewCasino
  fx: OverviewFx
  costs: OverviewCosts
  rooms: OverviewRoom[]
  routes: OverviewRoute[]
}

const FEE_TYPES: OverviewFeeType[] = ['deposit', 'withdraw', 'transfer']
const nameCollator = new Intl.Collator('ru')

/** Both dates required and strict: no implicit "all time" default, no tolerant parsing. */
function validatePeriod(dateFrom: unknown, dateTo: unknown): OverviewPeriod {
  if (typeof dateFrom !== 'string' || !isValidDayKey(dateFrom)) {
    throw new HttpError(400, 'dateFrom: must be a valid YYYY-MM-DD day')
  }
  if (typeof dateTo !== 'string' || !isValidDayKey(dateTo)) {
    throw new HttpError(400, 'dateTo: must be a valid YYYY-MM-DD day')
  }
  if (dateFrom > dateTo) throw new HttpError(400, 'dateFrom: must not be later than dateTo')
  return { dateFrom, dateTo }
}

export function moneyOverview(rawDateFrom: unknown, rawDateTo: unknown): MoneyOverview {
  const period = validatePeriod(rawDateFrom, rawDateTo)
  // One rate cache for the whole pass: rows repeat (room, currency, day) triples.
  return withRateCache(() => buildOverview(period))
}

function buildOverview(period: OverviewPeriod): MoneyOverview {
  const rows = listTransactions({ dateFrom: period.dateFrom, dateTo: period.dateTo })

  const cash: OverviewCash = { depositedUsd: 0, withdrawnUsd: 0, netInUsd: 0, missingRateRows: 0 }
  const fees: OverviewFees = {
    totalUsd: 0,
    rows: 0,
    missingRateRows: 0,
    byType: {
      deposit: { usd: 0, count: 0 },
      withdraw: { usd: 0, count: 0 },
      transfer: { usd: 0, count: 0 }
    },
    byCurrency: {},
    byRoom: []
  }
  const casino: OverviewCasino = {
    totalUsd: 0,
    winsUsd: 0,
    lossesUsd: 0,
    manualUsd: 0,
    autoUsd: 0,
    rows: 0,
    missingRateRows: 0,
    byReason: {
      casino: { usd: 0, count: 0 },
      fx: { usd: 0, count: 0 },
      other: { usd: 0, count: 0 }
    }
  }
  const fx: OverviewFx = {
    lossesUsd: 0,
    gainsUsd: 0,
    netLossUsd: 0,
    rows: 0,
    excluded: { noDestAmount: 0, sameCurrency: 0, noRate: 0 }
  }

  const roomById = new Map<number, OverviewRoom>()
  const room = (id: number, name: string): OverviewRoom => {
    const existing = roomById.get(id)
    if (existing) return existing
    const created: OverviewRoom = {
      roomId: id,
      name,
      depositedUsd: 0,
      withdrawnUsd: 0,
      feesUsd: 0,
      casinoUsd: 0,
      fxUsd: 0,
      costsUsd: 0,
      transfersOut: 0,
      transfersIn: 0
    }
    roomById.set(id, created)
    return created
  }

  const feeRoomById = new Map<number, OverviewFeeRoom>()
  const routeByKey = new Map<string, OverviewRoute>()

  for (const t of rows) {
    if (t.type === 'deposit' || t.type === 'withdraw') {
      const bucket = room(t.roomId, t.roomName)
      if (t.amountUsd === null) {
        cash.missingRateRows += 1
      } else if (t.type === 'deposit') {
        cash.depositedUsd += t.amountUsd
        bucket.depositedUsd += t.amountUsd
      } else {
        cash.withdrawnUsd += t.amountUsd
        bucket.withdrawnUsd += t.amountUsd
      }
    }

    // Fee breakdown by type/room. The top-level triple (totalUsd, byCurrency,
    // missingRateRows) is taken from `transactionsTotals` after the loop, so the
    // widget and the «Комиссии по фильтру» of the list can never disagree.
    if (t.fee > 0 && FEE_TYPES.includes(t.type as OverviewFeeType)) {
      const type = t.type as OverviewFeeType
      fees.rows += 1
      fees.byType[type].count += 1
      const feeRoom = feeRoomById.get(t.roomId) ?? { roomId: t.roomId, name: t.roomName, usd: 0, count: 0 }
      feeRoom.count += 1
      feeRoomById.set(t.roomId, feeRoom)
      if (t.feeUsd !== null) {
        fees.byType[type].usd += t.feeUsd
        feeRoom.usd += t.feeUsd
        room(t.roomId, t.roomName).feesUsd += t.feeUsd
      }
    }

    if (t.type === 'casino') {
      casino.rows += 1
      if (t.amountUsd === null) {
        casino.missingRateRows += 1
        continue
      }
      const value = t.amountUsd
      casino.totalUsd += value
      if (value > 0) casino.winsUsd += value
      else casino.lossesUsd += value
      if (t.writeoff) {
        casino.autoUsd += value
        const reason = t.writeoffReason ?? 'casino'
        casino.byReason[reason].usd += value
        casino.byReason[reason].count += 1
      } else {
        casino.manualUsd += value
      }
      room(t.roomId, t.roomName).casinoUsd += value
      continue
    }

    if (t.type !== 'transfer') continue

    // Routes answer "where did it go between my own rooms"; the transferred sum
    // itself is deliberately not added up: it is the user's own money moving
    // around, and summing it would double-count wallet-to-wallet churn.
    const key = `${t.roomId}|${t.destinationRoomId ?? 'gone'}`
    const route = routeByKey.get(key) ?? {
      fromRoomId: t.roomId,
      fromRoomName: t.roomName,
      toRoomId: t.destinationRoomId,
      toRoomName: t.destinationRoomName ?? '—',
      count: 0,
      feeUsd: 0,
      fxUsd: 0,
      costsUsd: 0,
      feeByCurrency: {}
    }
    route.count += 1
    route.feeByCurrency[t.currency] = (route.feeByCurrency[t.currency] ?? 0) + t.fee
    if (t.feeUsd !== null) route.feeUsd += t.feeUsd
    routeByKey.set(key, route)

    room(t.roomId, t.roomName).transfersOut += 1
    if (t.destinationRoomId !== null && t.destinationRoomName !== null) {
      room(t.destinationRoomId, t.destinationRoomName).transfersIn += 1
    }

    const bucket = transferFxBucket(t)
    if (bucket !== 'computed') {
      fx.excluded[bucket] += 1
      continue
    }
    if (t.destinationRoomId === null || t.fxDiffUsd === null) continue
    fx.rows += 1
    fx.netLossUsd += t.fxDiffUsd
    if (t.fxDiffUsd > 0) fx.lossesUsd += t.fxDiffUsd
    else if (t.fxDiffUsd < 0) fx.gainsUsd += -t.fxDiffUsd
    // The spread belongs to the route that carried the money, too.
    route.fxUsd += t.fxDiffUsd
    // The spread is paid where the money landed, so the receiver owns the number.
    room(t.destinationRoomId, t.destinationRoomName ?? '—').fxUsd += t.fxDiffUsd
  }

  const shared = transactionsTotals(rows)
  fees.totalUsd = shared.feeUsd
  fees.byCurrency = shared.feeByCurrency
  fees.missingRateRows = shared.missingRateRows

  cash.netInUsd = cash.depositedUsd - cash.withdrawnUsd

  // «Комиссии» как одна сущность: явная комиссия рума плюс курсовой спред на зачислении.
  // Выигрыш на курсе (отрицательная разница) вычитается; `casino`-списания с причиной `fx`
  // здесь отсутствуют намеренно — они остаток дня, а не удержанный румом процент.
  const costs: OverviewCosts = {
    totalUsd: fees.totalUsd + fx.netLossUsd,
    feesUsd: fees.totalUsd,
    fxNetLossUsd: fx.netLossUsd,
    fxLossesUsd: fx.lossesUsd,
    fxGainsUsd: fx.gainsUsd,
    missingRateRows: fees.missingRateRows,
    // переводы «между румами одной валюты» не считаются потерянной разницей: там сравнивать нечего
    fxNotCountedTransfers: fx.excluded.noDestAmount + fx.excluded.noRate
  }

  const rooms = [...roomById.values()]
    .map((r) => ({ ...r, costsUsd: r.feesUsd + r.fxUsd }))
    .sort((a, b) => nameCollator.compare(a.name, b.name))

  return {
    period,
    cash,
    fees: { ...fees, byRoom: byRoomOrder(feeRoomById) },
    casino,
    fx,
    costs,
    rooms,
    routes: [...routeByKey.values()]
      .map((r) => ({ ...r, costsUsd: r.feeUsd + r.fxUsd }))
      .sort(
        (a, b) => b.count - a.count || nameCollator.compare(a.fromRoomName, b.fromRoomName) || nameCollator.compare(a.toRoomName, b.toRoomName)
      )
  }
}

/** Biggest spenders first; ties broken by name so the table order is stable. */
function byRoomOrder(map: Map<number, OverviewFeeRoom>): OverviewFeeRoom[] {
  return [...map.values()].sort((a, b) => b.usd - a.usd || a.count - b.count || nameCollator.compare(a.name, b.name))
}
