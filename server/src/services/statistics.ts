import { getDb } from '../db.js'
import { HttpError } from '../lib/errors.js'
import { isValidDayKey } from '../lib/date.js'
import { convertToUsd, withRateCache } from './rates/convert.js'
import { scopeClause, type MbrScope } from './tournamentScope.js'

export type { MbrScope } from './tournamentScope.js'

export interface TimelinePoint {
  seq: number
  date: string
  roomId: number
  roomName: string
  profitUsd: number
  cumulativeUsd: number
}

export interface CalendarDay {
  date: string
  count: number
  profitUsd: number | null
}

export interface ActivityCalendar {
  year: number
  month: number
  totalCount: number
  totalProfitUsd: number
  blank: string | null
  days: CalendarDay[]
}

interface TournamentDb {
  id: number
  date: string
  room_id: number
  room_name: string
  buyin: number
  result: number
  currency: string
}

/**
 * Which tournaments a stats query looks at:
 *  - `mtt` — classic MTT analytics (statistics, calendar, goals); excludes MBR
 *  - `mbr` — the isolated Mystery Battle Royale block
 *  - `all` — every tournament; the money-bearing flows (reconciliation,
 *    profit chart) never pass a filter and therefore see MBR too.
 *
 * The type and predicates live in `tournamentScope.ts` so every service shares
 * one definition of the MBR rule.
 */

function allTournaments(mbr: MbrScope = 'all'): TournamentDb[] {
  return getDb()
    .prepare(
      `SELECT t.id, t.date, t.room_id, r.name AS room_name, t.buyin, t.result, t.currency
       FROM tournaments t JOIN rooms r ON r.id = t.room_id
       WHERE 1 = 1${scopeClause(mbr, 't.is_mbr')}
       ORDER BY t.date, t.id`
    )
    .all() as unknown as TournamentDb[]
}

/**
 * Cumulative tournament-profit timeline: every tournament is one point on the
 * chart (profit = result − buyin, converted to USD by the day rate).
 */
export function tournamentTimeline(): TimelinePoint[] {
  return withRateCache(() => {
    const points: TimelinePoint[] = []
    let cumulative = 0
    for (const row of allTournaments()) {
      const profitUsd = convertToUsd(row.result - row.buyin, row.currency, row.date, row.room_id)
      if (profitUsd === null) continue
      cumulative += profitUsd
      points.push({
        seq: points.length + 1,
        date: row.date,
        roomId: row.room_id,
        roomName: row.room_name,
        profitUsd,
        cumulativeUsd: cumulative
      })
    }
    return points
  })
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Tournament activity per day of a month. Counts = rows (blank 0/0 never stored).
 *  The whole poker scope (MTT + MBR): the calendar is a pure-poker block, so its
 *  daily profit is the day's tournament profit and its totals match the KPI row. */
export function activityCalendar(year: number, month: number): ActivityCalendar {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HttpError(400, 'year: out of range')
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new HttpError(400, 'month: 1..12 expected')

  return withRateCache(() => {
    const pad = (n: string | number) => String(n).padStart(2, '0')
    const dayCount = daysInMonth(year, month)
    const byDate = new Map<string, { count: number; profitUsd: number }>()
    let anyBlankRate = false

    for (const row of allTournaments('all')) {
      if (!row.date.startsWith(`${year}-${pad(month)}`)) continue
      const bucket = byDate.get(row.date) ?? { count: 0, profitUsd: 0 }
      bucket.count += 1
      const profitUsd = convertToUsd(row.result - row.buyin, row.currency, row.date, row.room_id)
      if (profitUsd !== null) {
        bucket.profitUsd += profitUsd
      } else {
        anyBlankRate = true
      }
      byDate.set(row.date, bucket)
    }

    const days: CalendarDay[] = []
    let totalCount = 0
    let totalProfitUsd = 0
    for (let d = 1; d <= dayCount; d++) {
      const key = `${year}-${pad(month)}-${pad(d)}`
      const bucket = byDate.get(key)
      if (bucket) {
        totalCount += bucket.count
        totalProfitUsd += bucket.profitUsd
        days.push({ date: key, count: bucket.count, profitUsd: bucket.profitUsd })
      } else {
        days.push({ date: key, count: 0, profitUsd: null })
      }
    }

    return {
      year,
      month,
      totalCount,
      totalProfitUsd,
      blank: anyBlankRate ? 'не все турниры удалось сконвертировать' : null,
      days
    }
  })
}

export interface SessionStat {
  date: string
  profitUsd: number | null
}

export interface TournamentPoint {
  seq: number
  date: string
  profitUsd: number
  cumulativeUsd: number
}

export interface TournamentDayCount {
  date: string
  count: number
}

/** The single most profitable tournament of a period (USD min units). */
export interface TopTournament {
  profitUsd: number
  date: string
  roomId: number
  roomName: string
}

export interface SessionStatsResult {
  sessions: SessionStat[]
  totalProfitUsd: number | null
  bestSessionUsd: number | null
  worstSessionUsd: number | null
  /** Total poker tournaments (MTT + MBR); `mbrCount` is the subset that is MBR. */
  tournamentCount: number
  mbrCount: number
  topTournament: TopTournament | null
  tournamentDays: TournamentDayCount[]
  profitSeries: TournamentPoint[]
  averageBuyinUsd: number | null
  roiPercent: number | null
}

interface TournamentAggregate {
  points: TournamentPoint[]
  totalBuyinUsd: number
  totalProfitUsd: number
  count: number
  topTournament: TopTournament | null
}

/**
 * Per-tournament USD data for a date range, converted with each day's frozen
 * rate. Every convertible tournament is one point; cumulativeUsd runs along
 * the series (profit = result − buyin exactly). Buyins are summed in USD for
 * ROI / average-buyin metrics. `topTournament` is the best single result of the
 * same rows, so it inherits the money scope (MBR included when mbr = 'all')
 * and skips rows without a convertible rate. When roomIds is provided, only
 * tournaments from those rooms are included.
 */
export function tournamentAggregate(dateFrom: string, dateTo: string, roomIds?: number[], mbr: MbrScope = 'all'): TournamentAggregate {
  return withRateCache(() => {
    let sql = `SELECT t.date, t.room_id, r.name AS roomName, t.buyin, t.result, t.currency
       FROM tournaments t JOIN rooms r ON r.id = t.room_id
       WHERE t.date >= ? AND t.date <= ?`
    const params: (string | number)[] = [dateFrom, dateTo]
    if (roomIds && roomIds.length > 0) {
      sql += ` AND t.room_id IN (${roomIds.map(() => '?').join(',')})`
      params.push(...roomIds)
    }
    sql += `${scopeClause(mbr, 't.is_mbr')} ORDER BY t.date, t.id`

    const rows = getDb()
      .prepare(sql)
      .all(...params) as unknown as { date: string; room_id: number; roomName: string; buyin: number; result: number; currency: string }[]

    const points: TournamentPoint[] = []
    let cumulative = 0
    let totalBuyinUsd = 0
    let totalProfitUsd = 0
    let topTournament: TopTournament | null = null
    for (const row of rows) {
      const buyinUsd = convertToUsd(row.buyin, row.currency, row.date, row.room_id)
      const profitUsd = convertToUsd(row.result - row.buyin, row.currency, row.date, row.room_id)
      if (buyinUsd === null || profitUsd === null) continue
      totalBuyinUsd += buyinUsd
      totalProfitUsd += profitUsd
      cumulative += profitUsd
      points.push({ seq: points.length + 1, date: row.date, profitUsd, cumulativeUsd: cumulative })
      // rows are ordered by date, id: a strict `>` keeps the earliest of equal results
      if (topTournament === null || profitUsd > topTournament.profitUsd) {
        topTournament = { profitUsd, date: row.date, roomId: row.room_id, roomName: row.roomName }
      }
    }
    return { points, totalBuyinUsd, totalProfitUsd, count: points.length, topTournament }
  })
}

export function tournamentProfitSeries(dateFrom: string, dateTo: string, roomIds?: number[], mbr: MbrScope = 'all'): TournamentPoint[] {
  return tournamentAggregate(dateFrom, dateTo, roomIds, mbr).points
}

/** Tournament play counts grouped per day inside a date range.
 *  When roomIds is provided, only tournaments from those rooms are counted.
 *  Defaults to the whole poker scope (MTT + MBR) — the "Турниров за день" chart
 *  must agree with the "Турниров" KPI. */
export function tournamentCountByDay(dateFrom: string, dateTo: string, roomIds?: number[], mbr: MbrScope = 'all'): TournamentDayCount[] {
  let sql = `SELECT date, COUNT(*) AS count FROM tournaments
       WHERE date >= ? AND date <= ?`
  const params: (string | number)[] = [dateFrom, dateTo]
  if (roomIds && roomIds.length > 0) {
    sql += ` AND room_id IN (${roomIds.map(() => '?').join(',')})`
    params.push(...roomIds)
  }
  sql += `${scopeClause(mbr, 'is_mbr')} GROUP BY date ORDER BY date`

  return getDb()
    .prepare(sql)
    .all(...params) as unknown as TournamentDayCount[]
}

/** One concrete tournament inside an aggregated group (accordion detail). */
export interface TournamentDetailRow {
  date: string
  roomName: string
  place: string | null
  buyinUsd: number | null
  profitUsd: number | null
}

/** Aggregated group: named (imported) by `name`, manual rows by their limit. */
export interface TournamentGroup {
  key: string
  label: string
  count: number
  totalBuyinUsd: number
  totalProfitUsd: number
  roiPercent: number | null
  bestRank: number | null
  avgEntrants: number | null
  rows: TournamentDetailRow[]
}

/** KPI + groups for the "Турниры" analytics tab. */
export interface TournamentSummary {
  count: number
  totalBuyinUsd: number
  totalProfitUsd: number
  roiPercent: number | null
  blank: string | null
  groups: TournamentGroup[]
}

function round2(x: number): number {
  return Math.round(x * 100) / 100
}

/** "Турниры за 250 RUB" label for manual rows: whole limit without decimals. */
function formatLimit(buyin: number, currency: string): string {
  const whole = Math.floor(buyin / 100)
  const frac = buyin % 100
  return frac === 0 ? `${whole} ${currency}` : `${whole}.${String(frac).padStart(2, '0')} ${currency}`
}

/**
 * Analytics aggregation for the "Турниры" tab.
 *
 * Grouping rule: rows with a `name` (GG imports) group by that name; manual rows
 * (name IS NULL) group by their limit `(currency, buyin)` and get a readable
 * label ("Турниры за 250 RUB"). Every tournament is converted to USD with its
 * own day's frozen cross-rate (room override respected). Counts always include
 * unconvertible rows, USD sums only accumulate on convertible ones and blank is
 * set when something had to be skipped. When roomIds is provided, only those
 * rooms' tournaments are aggregated.
 */
export function tournamentSummary(dateFrom: string, dateTo: string, roomIds: number[] | undefined, mbr: MbrScope): TournamentSummary {
  if (!isValidDayKey(dateFrom) || !isValidDayKey(dateTo)) throw new HttpError(400, 'summary: invalid date range')
  if (dateFrom > dateTo) throw new HttpError(400, 'summary: dateFrom must be <= dateTo')

  return withRateCache(() => {
    let sql = `SELECT t.date, t.room_id, r.name AS room_name, t.buyin, t.result, t.currency,
       t.name AS title, t.rank, t.entrants
       FROM tournaments t JOIN rooms r ON r.id = t.room_id
       WHERE t.date >= ? AND t.date <= ?`
    const params: (string | number)[] = [dateFrom, dateTo]
    if (roomIds && roomIds.length > 0) {
      sql += ` AND t.room_id IN (${roomIds.map(() => '?').join(',')})`
      params.push(...roomIds)
    }
    sql += `${scopeClause(mbr, 't.is_mbr')} ORDER BY t.date, t.id`

    const rows = getDb().prepare(sql).all(...params) as unknown as {
      date: string
      room_id: number
      room_name: string
      buyin: number
      result: number
      currency: string
      title: string | null
      rank: number | null
      entrants: number | null
    }[]

    const groups = new Map<string, TournamentGroup>()
    const entrants = new Map<string, { sum: number; n: number }>()
    let count = 0
    let totalBuyinUsd = 0
    let totalProfitUsd = 0
    let anyBlank = false

    for (const row of rows) {
      count++
      const key = row.title !== null ? `name:${row.title}` : `limit:${row.currency}:${row.buyin}`
      const label = row.title !== null ? row.title : `Турниры за ${formatLimit(row.buyin, row.currency)}`
      let group = groups.get(key)
      if (!group) {
        group = { key, label, count: 0, totalBuyinUsd: 0, totalProfitUsd: 0, roiPercent: null, bestRank: null, avgEntrants: null, rows: [] }
        groups.set(key, group)
      }
      group.count++

      const buyinUsd = convertToUsd(row.buyin, row.currency, row.date, row.room_id)
      const profitUsd = convertToUsd(row.result - row.buyin, row.currency, row.date, row.room_id)
      if (buyinUsd === null || profitUsd === null) {
        anyBlank = true
      } else {
        group.totalBuyinUsd += buyinUsd
        group.totalProfitUsd += profitUsd
        totalBuyinUsd += buyinUsd
        totalProfitUsd += profitUsd
      }

      if (row.rank !== null) group.bestRank = group.bestRank === null ? row.rank : Math.min(group.bestRank, row.rank)
      if (row.entrants !== null) {
        const acc = entrants.get(key) ?? { sum: 0, n: 0 }
        acc.sum += row.entrants
        acc.n += 1
        entrants.set(key, acc)
      }

      const place = row.rank !== null ? (row.entrants !== null ? `${row.rank} из ${row.entrants}` : `${row.rank}`) : null
      group.rows.push({ date: row.date, roomName: row.room_name, place, buyinUsd, profitUsd })
    }

    for (const group of groups.values()) {
      const acc = entrants.get(group.key)
      group.avgEntrants = acc && acc.n > 0 ? Math.round(acc.sum / acc.n) : null
      group.roiPercent = group.totalBuyinUsd > 0 ? round2((group.totalProfitUsd / group.totalBuyinUsd) * 100) : null
    }

    const roiPercent = totalBuyinUsd > 0 ? round2((totalProfitUsd / totalBuyinUsd) * 100) : null
    return {
      count,
      totalBuyinUsd,
      totalProfitUsd,
      roiPercent,
      blank: anyBlank ? 'не все турниры удалось сконвертировать' : null,
      groups: [...groups.values()]
    }
  })
}

export interface TournamentMbrBreakdownRow {
  buyin: number
  count: number
  profit: number
  roi: number | null
  avgPosition: number | null
}

export interface TournamentMbrKpi {
  count: number
  totalBuyinUsd: number
  totalProfitUsd: number
  roiPercent: number | null
  avgPosition: number | null
  blank: string | null
  breakdown: TournamentMbrBreakdownRow[]
}

function round1(x: number): number {
  return Math.round(x * 10) / 10
}

/**
 * KPI + per-buy-in breakdown of the isolated Mystery Battle Royale block.
 *
 * MBR is an 18-max hyper-turbo, so ABI is meaningless; the interesting per-limit
 * figures are field size (always 18), average finish (`AVG(rank)`) and ROI.
 * `buyin`/`profit` stay in minimal USD units like every other money value.
 */
export function tournamentMbrKpi(dateFrom: string, dateTo: string, roomIds?: number[]): TournamentMbrKpi {
  if (!isValidDayKey(dateFrom) || !isValidDayKey(dateTo)) throw new HttpError(400, 'mbr: invalid date range')
  if (dateFrom > dateTo) throw new HttpError(400, 'mbr: dateFrom must be <= dateTo')

  return withRateCache(() => {
    let sql = `SELECT t.date, t.room_id, t.buyin, t.result, t.currency, t.rank
       FROM tournaments t
       WHERE t.date >= ? AND t.date <= ?${scopeClause('mbr', 't.is_mbr')}`
    const params: (string | number)[] = [dateFrom, dateTo]
    if (roomIds && roomIds.length > 0) {
      sql += ` AND t.room_id IN (${roomIds.map(() => '?').join(',')})`
      params.push(...roomIds)
    }
    sql += ` ORDER BY t.date, t.id`

    const rows = getDb().prepare(sql).all(...params) as unknown as {
      date: string
      room_id: number
      buyin: number
      result: number
      currency: string
      rank: number | null
    }[]

    interface Acc {
      buyin: number
      count: number
      totalBuyinUsd: number
      totalProfitUsd: number
      positionSum: number
      positionCount: number
    }
    const groups = new Map<string, Acc>()
    let anyBlank = false
    let count = 0
    let totalBuyinUsd = 0
    let totalProfitUsd = 0
    let positionSum = 0
    let positionCount = 0

    for (const row of rows) {
      count++
      const key = `${row.currency}:${row.buyin}`
      let acc = groups.get(key)
      if (!acc) {
        acc = { buyin: row.buyin, count: 0, totalBuyinUsd: 0, totalProfitUsd: 0, positionSum: 0, positionCount: 0 }
        groups.set(key, acc)
      }
      acc.count++

      const buyinUsd = convertToUsd(row.buyin, row.currency, row.date, row.room_id)
      const profitUsd = convertToUsd(row.result - row.buyin, row.currency, row.date, row.room_id)
      if (buyinUsd === null || profitUsd === null) {
        anyBlank = true
      } else {
        acc.totalBuyinUsd += buyinUsd
        acc.totalProfitUsd += profitUsd
        totalBuyinUsd += buyinUsd
        totalProfitUsd += profitUsd
      }

      if (row.rank !== null) {
        acc.positionSum += row.rank
        acc.positionCount += 1
        positionSum += row.rank
        positionCount += 1
      }
    }

    const breakdown: TournamentMbrBreakdownRow[] = [...groups.values()]
      .sort((a, b) => a.buyin - b.buyin)
      .map((acc) => ({
        buyin: acc.buyin,
        count: acc.count,
        profit: acc.totalProfitUsd,
        roi: acc.totalBuyinUsd > 0 ? round2((acc.totalProfitUsd / acc.totalBuyinUsd) * 100) : null,
        avgPosition: acc.positionCount > 0 ? round1(acc.positionSum / acc.positionCount) : null
      }))

    return {
      count,
      totalBuyinUsd,
      totalProfitUsd,
      roiPercent: totalBuyinUsd > 0 ? round2((totalProfitUsd / totalBuyinUsd) * 100) : null,
      avgPosition: positionCount > 0 ? round1(positionSum / positionCount) : null,
      blank: anyBlank ? 'не все турниры удалось сконвертировать' : null,
      breakdown
    }
  })
}

/**
 * Poker-only statistics for a date range.
 *
 * "Статистика" is a pure poker zone: every figure derives from the `tournaments`
 * table (MTT, SnG, Spins and MBR — all poker formats). Cash movements never
 * enter this page — no deposits, withdrawals, casino transactions or manual
 * balance corrections. Profit per tournament is `result − buyin` (re-entries and
 * bounties are already folded into those numbers by the importers), converted to
 * USD with the tournament day's frozen rate.
 *
 * A session is a poker day: one entry per calendar day with at least one
 * tournament, its profit the day's sum of tournament profits. Best/worst session
 * is therefore the strongest/weakest poker day of the period. `totalProfitUsd`
 * is exactly the running total of `profitSeries`, so the KPI, the calendar and
 * the profit chart can never disagree.
 *
 * When roomIds is provided, only those rooms' tournaments are aggregated.
 */
export function sessionStats(dateFrom: string, dateTo: string, roomIds?: number[]): SessionStatsResult {
  if (!isValidDayKey(dateFrom) || !isValidDayKey(dateTo)) throw new HttpError(400, 'sessions: invalid date range')
  if (dateFrom > dateTo) throw new HttpError(400, 'sessions: dateFrom must be <= dateTo')

  return withRateCache(() => {
    const aggregate = tournamentAggregate(dateFrom, dateTo, roomIds, 'all')

    const byDate = new Map<string, number>()
    for (const point of aggregate.points) {
      byDate.set(point.date, (byDate.get(point.date) ?? 0) + point.profitUsd)
    }
    const sessions: SessionStat[] = [...byDate.entries()].map(([date, profitUsd]) => ({ date, profitUsd }))
    const profits = [...byDate.values()]

    return {
      sessions,
      totalProfitUsd: aggregate.points.length > 0 ? aggregate.totalProfitUsd : null,
      bestSessionUsd: profits.length > 0 ? Math.max(...profits) : null,
      worstSessionUsd: profits.length > 0 ? Math.min(...profits) : null,
      tournamentCount: countTournaments(dateFrom, dateTo, roomIds, 'all'),
      mbrCount: countTournaments(dateFrom, dateTo, roomIds, 'mbr'),
      topTournament: aggregate.topTournament,
      tournamentDays: tournamentCountByDay(dateFrom, dateTo, roomIds, 'all'),
      profitSeries: aggregate.points,
      averageBuyinUsd: aggregate.count > 0 ? Math.round(aggregate.totalBuyinUsd / aggregate.count) : null,
      roiPercent: aggregate.totalBuyinUsd > 0 ? Math.round((aggregate.totalProfitUsd / aggregate.totalBuyinUsd) * 100 * 100) / 100 : null
    }
  })
}

/** Tournament count for a period, honouring both the room and the MBR scope. */
function countTournaments(dateFrom: string, dateTo: string, roomIds: number[] | undefined, mbr: MbrScope): number {
  let sql = `SELECT COUNT(*) AS count FROM tournaments WHERE date >= ? AND date <= ?${scopeClause(mbr, 'is_mbr')}`
  const params: (string | number)[] = [dateFrom, dateTo]
  if (roomIds && roomIds.length > 0) {
    sql += ` AND room_id IN (${roomIds.map(() => '?').join(',')})`
    params.push(...roomIds)
  }
  const row = getDb()
    .prepare(sql)
    .get(...params) as { count: number }
  return row.count
}