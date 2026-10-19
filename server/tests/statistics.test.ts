import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import { createRoom } from '../src/services/rooms.js'
import { createTransaction } from '../src/services/funds.js'
import { upsertBalance } from '../src/services/balances.js'
import { reconcileDay, replaceDayTournaments, saveDayBatch } from '../src/services/tournaments.js'
import type { TournamentImportInput } from '../src/services/tournaments.js'
import { activityCalendar, sessionStats, tournamentMbrKpi, tournamentProfitSeries, tournamentSummary, tournamentTimeline } from '../src/services/statistics.js'
import { upsertRate } from '../src/services/rates/storage.js'

let pokerdon: number
let redstar: number

beforeEach(() => {
  setDbForTests(initDb(':memory:'))
  pokerdon = createRoom({ name: 'PokerDom', cashCurrency: 'USD', tournamentCurrency: 'RUB' }).id
  redstar = createRoom({ name: 'RedStar', cashCurrency: 'EUR', tournamentCurrency: 'EUR' }).id
  upsertRate('2026-09-10', 'USD', 'RUB', Math.round(90 * 10_000), 'pokerdom')
  upsertRate('2026-09-11', 'USD', 'RUB', Math.round(90 * 10_000), 'pokerdom')
  upsertRate('2026-09-10', 'EUR', 'USD', Math.round(1.1 * 10_000), 'er-api')
})

afterEach(() => resetDbForTests())

describe('statistics', () => {
  it('builds a cumulative timeline where every tournament is a point', () => {
    // PokerDom 2026-09-10: +30 RUB profit ≈ $33
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'RUB' }])
    // PokerDom 2026-09-11: −10 RUB (bust pair) ≈ −$11
    replaceDayTournaments(pokerdon, '2026-09-11', [{ buyin: 50_00, result: 40_00, currency: 'RUB' }])
    // RedStar 2026-09-11: +€5 = +$5.50 (EUR rate 1.1) — day 11 uses fallback/frozen rate 1.1
    replaceDayTournaments(redstar, '2026-09-11', [{ buyin: 100_00, result: 105_00, currency: 'EUR' }])

    const timeline = tournamentTimeline()
    expect(timeline).toHaveLength(3)
    // ordered by date, then id
    expect(timeline.map((p) => p.date)).toEqual(['2026-09-10', '2026-09-11', '2026-09-11'])
    expect(timeline[0].profitUsd).toBe(Math.round((30_00 * 10_000 * 10_000) / (90 * 10_000) / 10_000))
    expect(timeline[0].cumulativeUsd).toBe(timeline[0].profitUsd)
    const secondProfit = Math.round((-10_00 * 10_000 * 10_000) / (90 * 10_000) / 10_000)
    expect(timeline[1].profitUsd).toBe(secondProfit)
    expect(timeline[1].cumulativeUsd).toBe(timeline[0].cumulativeUsd + secondProfit)
    expect(timeline[2].profitUsd).toBe(5_00 * 1.1)
    expect(timeline[2].cumulativeUsd).toBe(timeline[1].cumulativeUsd + 5_50)
  })

  it('breaks a tournament up: bust means −buyin', () => {
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 100_00, result: 0, currency: 'RUB' }])
    const timeline = tournamentTimeline()
    expect(timeline).toHaveLength(1)
    expect(timeline[0].profitUsd).toBe(Math.round((-100_00 * 10_000 * 10_000) / (90 * 10_000) / 10_000))
  })

  it('counts tournaments per day in a month and totals', () => {
    replaceDayTournaments(pokerdon, '2026-09-10', [
      { buyin: 50_00, result: 80_00, currency: 'RUB' },
      { buyin: 20_00, result: 0, currency: 'RUB' }
    ])
    replaceDayTournaments(pokerdon, '2026-09-11', [{ buyin: 50_00, result: 40_00, currency: 'RUB' }])
    replaceDayTournaments(redstar, '2026-09-20', [{ buyin: 100_00, result: 105_00, currency: 'EUR' }])

    const cal = activityCalendar(2026, 9)
    expect(cal.totalCount).toBe(4)
    expect(cal.days).toHaveLength(30)
    expect(cal.days.find((d) => d.date === '2026-09-10')?.count).toBe(2)
    expect(cal.days.find((d) => d.date === '2026-09-11')?.count).toBe(1)
    const expectedProfit =
      Math.round((30_00 * 10_000 * 10_000) / (90 * 10_000) / 10_000) +
      Math.round((-20_00 * 10_000 * 10_000) / (90 * 10_000) / 10_000) +
      Math.round((-10_00 * 10_000 * 10_000) / (90 * 10_000) / 10_000) +
      5_50
    expect(cal.totalProfitUsd).toBe(expectedProfit)
  })

  it('empty months have zero counts and other months stay clean', () => {
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'RUB' }])
    const cal = activityCalendar(2026, 10)
    expect(cal.totalCount).toBe(0)
    expect(cal.days).toHaveLength(31)
    expect(cal.days.every((d) => d.count === 0)).toBe(true)
  })

  it('validates year/month', () => {
    expect(() => activityCalendar(1999, 1)).toThrow(/year/)
    expect(() => activityCalendar(2026, 13)).toThrow(/month/)
  })
})

describe('sessionStats', () => {
  it('counts one poker session per day with tournaments, ignoring cash-only days', () => {
    // two rooms played on 09-10 → still one session
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'RUB' }])
    replaceDayTournaments(redstar, '2026-09-10', [{ buyin: 100_00, result: 105_00, currency: 'EUR' }])
    // a deposit-only day (no tournaments) is cash, not a poker session
    createTransaction({ roomId: pokerdon, type: 'deposit', amount: 50_00, currency: 'USD', direction: 'in', date: '2026-09-11' })

    const stats = sessionStats('2026-09-10', '2026-09-12')
    expect(stats.sessions).toHaveLength(1)
    expect(stats.sessions[0].date).toBe('2026-09-10')
  })

  it('session profit is the day sum of tournament profits; best/worst selected across the period', () => {
    const usd = createRoom({ name: 'USD Room', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    replaceDayTournaments(usd, '2026-09-10', [{ buyin: 0, result: 40_00, currency: 'USD' }]) // +$40
    replaceDayTournaments(usd, '2026-09-11', [{ buyin: 100_00, result: 70_00, currency: 'USD' }]) // −$30

    const stats = sessionStats('2026-09-10', '2026-09-11')
    expect(stats.sessions).toHaveLength(2)
    expect(stats.sessions[0].profitUsd).toBe(40_00)
    expect(stats.sessions[1].profitUsd).toBe(-30_00)
    expect(stats.totalProfitUsd).toBe(10_00)
    expect(stats.bestSessionUsd).toBe(40_00)
    expect(stats.worstSessionUsd).toBe(-30_00)
  })

  it('best/worst use the whole-day total across rooms, not a single room', () => {
    const a = createRoom({ name: 'A', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    const b = createRoom({ name: 'B', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    replaceDayTournaments(a, '2026-09-10', [{ buyin: 0, result: 40_00, currency: 'USD' }]) // +$40
    replaceDayTournaments(b, '2026-09-10', [{ buyin: 0, result: 2_00, currency: 'USD' }]) // +$2
    replaceDayTournaments(a, '2026-09-11', [{ buyin: 30_00, result: 0, currency: 'USD' }]) // −$30

    const stats = sessionStats('2026-09-10', '2026-09-11')
    expect(stats.sessions.find((s) => s.date === '2026-09-10')?.profitUsd).toBe(42_00)
    expect(stats.bestSessionUsd).toBe(42_00)
    expect(stats.worstSessionUsd).toBe(-30_00)
  })

  it('returns empty metrics when the period has no tournaments (a manual balance alone is not a session)', () => {
    upsertBalance(pokerdon, '2026-09-10', 100_00, 'USD')

    const stats = sessionStats('2026-09-10', '2026-09-11')
    expect(stats.sessions).toEqual([])
    expect(stats.totalProfitUsd).toBeNull()
    expect(stats.bestSessionUsd).toBeNull()
    expect(stats.worstSessionUsd).toBeNull()
    expect(stats.tournamentCount).toBe(0)
  })

  it('validates the date range', () => {
    expect(() => sessionStats('x', '2026-09-11')).toThrow(/range/)
    expect(() => sessionStats('2026-09-12', '2026-09-11')).toThrow(/<=/)
  })

  it('filters tournaments and counts by roomIds', () => {
    // PokerDom 09-10: +30 RUB, RedStar 09-10: +€5
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'RUB' }])
    replaceDayTournaments(redstar, '2026-09-10', [{ buyin: 100_00, result: 105_00, currency: 'EUR' }])

    const all = sessionStats('2026-09-10', '2026-09-11')
    expect(all.tournamentCount).toBe(2)
    expect(all.profitSeries).toHaveLength(2)

    const onlyPokerdom = sessionStats('2026-09-10', '2026-09-11', [pokerdon])
    expect(onlyPokerdom.tournamentCount).toBe(1)
    expect(onlyPokerdom.profitSeries).toHaveLength(1)
    expect(onlyPokerdom.profitSeries[0].profitUsd).toBe(Math.round((30_00 * 10_000 * 10_000) / (90 * 10_000) / 10_000))
    expect(onlyPokerdom.tournamentDays).toEqual([{ date: '2026-09-10', count: 1 }])

    const onlyRedstar = sessionStats('2026-09-10', '2026-09-11', [redstar])
    expect(onlyRedstar.tournamentCount).toBe(1)
    expect(onlyRedstar.tournamentDays).toEqual([{ date: '2026-09-10', count: 1 }])
  })

  it('session profit sums only the selected rooms when roomIds given', () => {
    // PokerDom 09-10: +100 RUB ≈ +$1.11; RedStar 09-10: +€5 = +$5.50
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 100_00, result: 200_00, currency: 'RUB' }])
    replaceDayTournaments(redstar, '2026-09-10', [{ buyin: 100_00, result: 105_00, currency: 'EUR' }])

    const all = sessionStats('2026-09-10', '2026-09-10')
    expect(all.sessions).toHaveLength(1)
    expect(all.sessions[0].profitUsd).toBe(111 + 5_50)

    const onlyPokerdom = sessionStats('2026-09-10', '2026-09-10', [pokerdon])
    expect(onlyPokerdom.sessions).toHaveLength(1)
    expect(onlyPokerdom.sessions[0].profitUsd).toBe(111)
    expect(onlyPokerdom.totalProfitUsd).toBe(111)
    expect(onlyPokerdom.bestSessionUsd).toBe(111)
    expect(onlyPokerdom.worstSessionUsd).toBe(111)

    const onlyRedstar = sessionStats('2026-09-10', '2026-09-10', [redstar])
    expect(onlyRedstar.sessions[0].profitUsd).toBe(5_50)
  })

  it('a session appears for the selected rooms that played', () => {
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'RUB' }])
    replaceDayTournaments(redstar, '2026-09-11', [{ buyin: 100_00, result: 105_00, currency: 'EUR' }])

    expect(sessionStats('2026-09-10', '2026-09-11', [pokerdon]).sessions.map((s) => s.date)).toEqual(['2026-09-10'])
    expect(sessionStats('2026-09-10', '2026-09-11', [redstar]).sessions.map((s) => s.date)).toEqual(['2026-09-11'])
    expect(sessionStats('2026-09-10', '2026-09-11', [pokerdon, redstar]).sessions).toHaveLength(2)
  })

  it('tournamentProfitSeries is empty for rooms without tournaments', () => {
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'RUB' }])
    expect(tournamentProfitSeries('2026-09-10', '2026-09-11', [redstar])).toEqual([])
    expect(tournamentProfitSeries('2026-09-10', '2026-09-11', [pokerdon])).toHaveLength(1)
  })

  it('profitSeries is per-tournament and cumulative with per-day rates', () => {
    // PokerDom 09-10: +30 RUB (~$33), 09-11: −10 RUB (~−$11)
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'RUB' }])
    replaceDayTournaments(pokerdon, '2026-09-11', [{ buyin: 50_00, result: 40_00, currency: 'RUB' }])
    const s10 = sessionStats('2026-09-10', '2026-09-11').profitSeries
    expect(s10).toHaveLength(2)
    expect(s10[0].seq).toBe(1)
    expect(s10[1].seq).toBe(2)
    expect(s10[0].profitUsd).toBe(Math.round((30_00 * 10_000 * 10_000) / (90 * 10_000) / 10_000))
    expect(s10[1].cumulativeUsd).toBe(s10[0].cumulativeUsd + s10[1].profitUsd)
    // one point per tournament regardless of how many share a day
    replaceDayTournaments(pokerdon, '2026-09-10', [
      { buyin: 1_00, result: 2_00, currency: 'RUB' },
      { buyin: 1_00, result: 0, currency: 'RUB' }
    ])
    expect(sessionStats('2026-09-10', '2026-09-10').profitSeries).toHaveLength(2)
  })

  it('tournamentDays groups daily count inside the range', () => {
    replaceDayTournaments(pokerdon, '2026-09-10', [
      { buyin: 50_00, result: 80_00, currency: 'RUB' },
      { buyin: 20_00, result: 0, currency: 'RUB' }
    ])
    replaceDayTournaments(redstar, '2026-09-11', [{ buyin: 100_00, result: 105_00, currency: 'EUR' }])
    const days = sessionStats('2026-09-10', '2026-09-11').tournamentDays
    expect(days).toEqual([
      { date: '2026-09-10', count: 2 },
      { date: '2026-09-11', count: 1 }
    ])
    expect(sessionStats('2026-09-11', '2026-09-30').tournamentDays).toEqual([{ date: '2026-09-11', count: 1 }])
  })

  it('computes average buyin (USD) and ROI percent, and returns nulls on an empty period', () => {
    const usdRoom = createRoom({ name: 'Stars', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    replaceDayTournaments(usdRoom, '2026-09-10', [
      { buyin: 100_00, result: 150_00, currency: 'USD' },
      { buyin: 50_00, result: 0, currency: 'USD' },
      { buyin: 50_00, result: 25_00, currency: 'USD' }
    ])

    const stats = sessionStats('2026-09-10', '2026-09-10')
    expect(stats.tournamentCount).toBe(3)
    // total buyin $200, avg = 20000/3 ≈ 6667 min units ($66.67)
    expect(stats.averageBuyinUsd).toBe(Math.round(200_00 / 3))
    expect(stats.averageBuyinUsd).toBe(6667)
    // total profit −$25 → ROI = (−2500 / 20000) × 100 = −12.5%
    expect(stats.roiPercent).toBe(-12.5)

    const empty = sessionStats('2026-09-20', '2026-09-21')
    expect(empty.averageBuyinUsd).toBeNull()
    expect(empty.roiPercent).toBeNull()
  })

  it('ROI and average buyin respect the roomIds filter', () => {
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 100_00, result: 200_00, currency: 'RUB' }])

    const all = sessionStats('2026-09-10', '2026-09-10')
    // profit === buyin (RUB 100_00) → ROI ровно 100%
    expect(all.roiPercent).toBe(100)
    // buyin $100 → ₽100 по 90 = $111.11 → 111 min units
    expect(all.averageBuyinUsd).toBe(Math.round((100_00 * 10_000 * 10_000) / (90 * 10_000) / 10_000))

    const none = sessionStats('2026-09-10', '2026-09-10', [redstar])
    expect(none.averageBuyinUsd).toBeNull()
    expect(none.roiPercent).toBeNull()
  })

  it('keeps every block in agreement and ignores cash movements', () => {
    const usd = createRoom({ name: 'PokerUSD', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    replaceDayTournaments(usd, '2026-09-15', [
      { buyin: 10_00, result: 30_00, currency: 'USD' }, // +$20
      { buyin: 10_00, result: 0, currency: 'USD' } // −$10
    ])
    // cash movements that must never reach the statistics page
    createTransaction({ roomId: usd, type: 'deposit', amount: 500_00, currency: 'USD', direction: 'in', date: '2026-09-15' })
    createTransaction({ roomId: usd, type: 'casino', amount: -80_00, currency: 'USD', date: '2026-09-15' })
    upsertBalance(usd, '2026-09-15', 123_45, 'USD') // manual correction, also ignored

    const stats = sessionStats('2026-09-01', '2026-09-30')
    const chartTotal = stats.profitSeries.at(-1)?.cumulativeUsd ?? null
    const sessionSum = stats.sessions.reduce((acc, s) => acc + (s.profitUsd ?? 0), 0)

    expect(stats.totalProfitUsd).toBe(10_00) // only +$20 − $10
    expect(chartTotal).toBe(stats.totalProfitUsd) // chart итог === KPI «Профит»
    expect(sessionSum).toBe(stats.totalProfitUsd)
    expect(stats.bestSessionUsd).toBe(10_00)
    expect(stats.worstSessionUsd).toBe(10_00)

    const cal = activityCalendar(2026, 9)
    expect(cal.totalProfitUsd).toBe(stats.totalProfitUsd) // calendar total === KPI
    expect(cal.totalCount).toBe(stats.tournamentCount)
  })
})

describe('tournamentSummary', () => {
  const imp = (over: Partial<TournamentImportInput>): TournamentImportInput => ({
    tournamentId: 1,
    name: 'Bounty Hunters $3.20',
    date: '2026-09-11',
    buyin: 3_20,
    result: 5_60,
    rank: 33,
    entrants: 400,
    currency: 'USD',
    ...over
  })

  it('aggregates named rows by title with profit/ROI/best-place/avg-entrants', () => {
    saveDayBatch(pokerdon, '2026-09-11', [], [
      imp({}),
      imp({ tournamentId: 2, date: '2026-09-10', result: 0, rank: 112, entrants: 500 })
    ])

    const summary = tournamentSummary('2026-09-10', '2026-09-11', undefined, 'all')
    expect(summary.count).toBe(2)
    expect(summary.totalBuyinUsd).toBe(6_40)
    // +2.40 − 3.20 = −0.80
    expect(summary.totalProfitUsd).toBe(-80)
    expect(summary.roiPercent).toBe(-12.5)
    expect(summary.blank).toBeNull()

    const group = summary.groups.find((g) => g.label === 'Bounty Hunters $3.20')
    expect(group).toBeDefined()
    expect(group).toMatchObject({ count: 2, totalBuyinUsd: 640, totalProfitUsd: -80, bestRank: 33, avgEntrants: 450 })
    expect(group?.roiPercent).toBe(-12.5)
    expect(group?.rows).toHaveLength(2)
    expect(group?.rows[0]).toMatchObject({ date: '2026-09-10', place: '112 из 500' })
    expect(group?.rows[1]).toMatchObject({ date: '2026-09-11', place: '33 из 400' })
  })

  it('groups manual rows (no name) by their limit with a readable label', () => {
    replaceDayTournaments(pokerdon, '2026-09-10', [
      { buyin: 250_00, result: 0, currency: 'RUB' },
      { buyin: 250_00, result: 400_00, currency: 'RUB' }
    ])

    const summary = tournamentSummary('2026-09-10', '2026-09-10', undefined, 'all')
    const group = summary.groups.find((g) => g.label === 'Турниры за 250 RUB')
    expect(group).toBeDefined()
    expect(group).toMatchObject({ count: 2 })
    // buyin 250 RUB ×2 @ 90 → $5.55; profit (0 − 250) + (400 − 250) = −100 RUB → −$1.11
    expect(group?.totalBuyinUsd).toBe(Math.round((2 * 250_00 * 10_000 * 10_000) / (90 * 10_000) / 10_000))
    // per-row rounding: −25000 → −$2.78, +15000 → +$1.67 → −$1.11 total
    expect(group?.totalProfitUsd).toBe(-111)
    expect(group?.bestRank).toBeNull()
    expect(group?.avgEntrants).toBeNull()
  })

  it('converts each day with its frozen cross-rate (USD/RUB/EUR)', () => {
    upsertRate('2026-09-11', 'EUR', 'USD', Math.round(1.1 * 10_000), 'er-api')
    upsertRate('2026-09-11', 'USD', 'CNY', Math.round(7.2 * 10_000), 'er-api')
    // PokerDom manual RUB rows and an imported CNY row land in different groups
    saveDayBatch(pokerdon, '2026-09-11', [], [
      imp({ tournamentId: 9, currency: 'CNY', buyin: 5_00, result: 7_20, name: 'CNY Turbo', rank: null, entrants: null })
    ])
    const summary = tournamentSummary('2026-09-11', '2026-09-11', undefined, 'all')
    const cny = summary.groups.find((g) => g.label === 'CNY Turbo')
    // +2.20 ¥ at 7.2 ¥/$ → +$0.31
    expect(cny?.totalProfitUsd).toBe(31)
  })

  it('filters by room and date range', () => {
    saveDayBatch(pokerdon, '2026-09-11', [], [imp({})])
    saveDayBatch(redstar, '2026-09-12', [], [imp({ tournamentId: 3, name: 'Red Turbo', date: '2026-09-12' })])

    const filtered = tournamentSummary('2026-09-11', '2026-09-12', [pokerdon], 'all')
    expect(filtered.count).toBe(1)
    expect(filtered.groups.map((g) => g.label)).toEqual(['Bounty Hunters $3.20'])

    const narrow = tournamentSummary('2026-09-12', '2026-09-12', undefined, 'all')
    expect(narrow.count).toBe(1)
    expect(narrow.groups.map((g) => g.label)).toEqual(['Red Turbo'])
  })

  it('rejects an inverted range', () => {
    expect(() => tournamentSummary('2026-09-12', '2026-09-10', undefined, 'all')).toThrow(/must be <=/)
  })

  it('sets blank when a row cannot be converted', () => {
    // CNY with no rate at all → conversion fails, row still counted
    saveDayBatch(pokerdon, '2026-09-10', [], [
      imp({ tournamentId: 5, date: '2026-09-10', currency: 'CNY', buyin: 5_00, result: 5_00, rank: null, entrants: null })
    ])
    const summary = tournamentSummary('2026-09-10', '2026-09-10', undefined, 'all')
    expect(summary.count).toBe(1)
    expect(summary.blank).toBe('не все турниры удалось сконвертировать')
    expect(summary.totalProfitUsd).toBe(0)
  })
})

describe('MBR isolation', () => {
  const mbr = (over: Partial<TournamentImportInput>): TournamentImportInput => ({
    tournamentId: 2,
    name: "Mystery Battle Royale $1, Hold'em No Limit",
    date: '2026-09-16',
    buyin: 1_00,
    result: 0,
    rank: null,
    entrants: null,
    currency: 'USD',
    ...over
  })

  function seed(): number {
    const gg = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    saveDayBatch(gg, '2026-09-16', [], [
      mbr({ tournamentId: 2, result: 0, rank: 5 }), // −$1.00
      mbr({ tournamentId: 3, result: 5_50, rank: 3 }), // +$4.50
      {
        tournamentId: 4,
        name: 'Daily Turbo 5.50',
        date: '2026-09-16',
        buyin: 5_50,
        result: 11_00,
        rank: null,
        entrants: null,
        currency: 'USD'
      } // +$5.50
    ])
    return gg
  }

  it('counts MBR as poker everywhere on the statistics page', () => {
    seed()
    const stats = sessionStats('2026-09-16', '2026-09-16')

    // every figure is pure poker over all formats (MTT + MBR)
    expect(stats.profitSeries).toHaveLength(3)
    expect(stats.profitSeries.map((p) => p.cumulativeUsd)).toEqual([-100, 350, 900])
    expect(stats.tournamentCount).toBe(3)
    expect(stats.mbrCount).toBe(2)
    // total buy-in $7.50 over 3 tournaments, profit +$9.00 → ROI 120%
    expect(stats.averageBuyinUsd).toBe(250)
    expect(stats.roiPercent).toBe(120)
    expect(stats.totalProfitUsd).toBe(900)
    expect(stats.tournamentDays).toEqual([{ date: '2026-09-16', count: 3 }])
  })

  it('reports the best tournament of the period as money (MBR included)', () => {
    const gg = seed()
    const stats = sessionStats('2026-09-16', '2026-09-16')

    // +$5.50 MTT beats the +$4.50 MBR; the tie rule keeps the earliest row
    expect(stats.topTournament).toEqual({ profitUsd: 5_50, date: '2026-09-16', roomId: gg, roomName: 'GG' })
  })

  it('mbrCount and topTournament follow the roomIds filter', () => {
    const gg = seed()
    const club = createRoom({ name: 'Club', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    saveDayBatch(club, '2026-09-16', [], [
      { tournamentId: 20, name: 'Huge Sunday', date: '2026-09-16', buyin: 100_00, result: 900_00, rank: null, entrants: null, currency: 'USD' }
    ])

    const stats = sessionStats('2026-09-16', '2026-09-16', [club])
    expect(stats.mbrCount).toBe(0)
    expect(stats.topTournament).toEqual({
      profitUsd: 800_00,
      date: '2026-09-16',
      roomId: club,
      roomName: 'Club'
    })
    expect(sessionStats('2026-09-16', '2026-09-16', [gg]).mbrCount).toBe(2)
  })

  it('topTournament is null for an empty period', () => {
    const stats = sessionStats('2026-09-01', '2026-09-05')
    expect(stats.topTournament).toBeNull()
    expect(stats.mbrCount).toBe(0)
  })

  it('isolates MBR into its own KPI block under the main summary', () => {
    seed()
    // the money view asks explicitly for every tournament
    expect(tournamentSummary('2026-09-16', '2026-09-16', undefined, 'all').count).toBe(3)
    // the classic MTT table asks for 'mtt'
    expect(tournamentSummary('2026-09-16', '2026-09-16', undefined, 'mtt').count).toBe(1)

    const kpi = tournamentMbrKpi('2026-09-16', '2026-09-16')
    expect(kpi).toMatchObject({
      count: 2,
      totalBuyinUsd: 2_00,
      totalProfitUsd: 3_50, // −1.00 + 4.50
      roiPercent: 175,
      avgPosition: 4, // (5 + 3) / 2
      blank: null,
      breakdown: [{ buyin: 1_00, count: 2, profit: 3_50, roi: 175, avgPosition: 4 }]
    })
  })

  it('breaks the MBR block down by buy-in with average finish', () => {
    const gg = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    saveDayBatch(gg, '2026-09-16', [], [
      mbr({ tournamentId: 10, buyin: 1_00, result: 0, rank: 2 }),
      mbr({ tournamentId: 11, buyin: 1_00, result: 2_00, rank: 6 }),
      mbr({ tournamentId: 12, buyin: 3_00, result: 0, rank: 18 })
    ])

    const kpi = tournamentMbrKpi('2026-09-16', '2026-09-16')
    expect(kpi.breakdown).toEqual([
      { buyin: 1_00, count: 2, profit: 0, roi: 0, avgPosition: 4 },
      { buyin: 3_00, count: 1, profit: -3_00, roi: -100, avgPosition: 18 }
    ])
  })

  it('surfaces arbitrary MBR buy-ins straight from the database', () => {
    const gg = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    saveDayBatch(gg, '2026-09-16', [], [
      mbr({ tournamentId: 20, buyin: 5_00, result: 5_00, rank: 1 }),
      mbr({ tournamentId: 21, buyin: 10_50, result: 0, rank: 18 })
    ])

    const kpi = tournamentMbrKpi('2026-09-16', '2026-09-16')
    expect(kpi.breakdown).toEqual([
      { buyin: 5_00, count: 1, profit: 0, roi: 0, avgPosition: 1 },
      { buyin: 10_50, count: 1, profit: -10_50, roi: -100, avgPosition: 18 }
    ])
  })

  it('activityCalendar is pure poker and therefore counts MBR rows too', () => {
    seed()
    const cal = activityCalendar(2026, 9)
    expect(cal.totalCount).toBe(3)
    expect(cal.days.find((d) => d.date === '2026-09-16')?.count).toBe(3)
    expect(cal.totalProfitUsd).toBe(900)
  })

  it('tournamentProfitSeries honours the mbr scope', () => {
    seed()
    expect(tournamentProfitSeries('2026-09-16', '2026-09-16', undefined, 'mbr')).toHaveLength(2)
    expect(tournamentProfitSeries('2026-09-16', '2026-09-16', undefined, 'mtt')).toHaveLength(1)
    expect(tournamentProfitSeries('2026-09-16', '2026-09-16')).toHaveLength(3)
  })

  it('treats an MBR-only day as a gaming session and keeps its money in stats/reconcile', () => {
    const gg = createRoom({ name: 'GG2', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    upsertBalance(gg, '2026-09-15', 100_00, 'USD')
    saveDayBatch(gg, '2026-09-16', [], [
      mbr({ tournamentId: 2, result: 0, rank: 5 }), // −$1.00
      mbr({ tournamentId: 3, result: 5_00, rank: 1 }) // +$4.00
    ])
    upsertBalance(gg, '2026-09-16', 103_00, 'USD') // +$3.00 = MBR net

    const stats = sessionStats('2026-09-16', '2026-09-16')
    // the MBR-only day is a real poker session; its profit comes from the tournaments
    expect(stats.sessions).toEqual([{ date: '2026-09-16', profitUsd: 3_00 }])
    expect(stats.totalProfitUsd).toBe(3_00)
    // MBR is poker on the statistics page (no longer isolated from the count)
    expect(stats.tournamentCount).toBe(2)
    expect(stats.mbrCount).toBe(2)

    // the balance reconcile closes to zero, so MBR money is accounted for
    const reconcile = reconcileDay(gg, '2026-09-16')
    expect(reconcile.tournamentProfitUsd).toBe(3_00)
    expect(reconcile.remainderUsd).toBe(0)
    expect(reconcile.flagged).toBe(false)
  })
})