import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initDb, resetDbForTests, setDbForTests, getDb } from '../src/db.js'
import { createRoom } from '../src/services/rooms.js'
import { createTransaction } from '../src/services/funds.js'
import { getBalance, upsertBalance } from '../src/services/balances.js'
import {
  adjustBalanceToTournaments,
  deleteImportedTournament,
  isMbrByName,
  listDayTournaments,
  previewDayReconcile,
  reconcileDay,
  reconcileSummary,
  replaceDayTournaments,
  saveDayBatch,
  tournamentProfitUsd,
  tournamentsExistMap,
  writeoffCasinoRemainder
} from '../src/services/tournaments.js'
import type { TournamentImportInput } from '../src/services/tournaments.js'
import { upsertRate } from '../src/services/rates/storage.js'

let pokerdon: number
let redstar: number

beforeEach(() => {
  setDbForTests(initDb(':memory:'))
  pokerdon = createRoom({ name: 'pokerdom', cashCurrency: 'USD', tournamentCurrency: 'RUB' }).id
  redstar = createRoom({ name: 'RedStar', cashCurrency: 'EUR', tournamentCurrency: 'EUR' }).id
  upsertRate('2026-09-10', 'USD', 'RUB', Math.round(90 * 10_000), 'pokerdom')
  upsertRate('2026-09-11', 'USD', 'RUB', Math.round(90 * 10_000), 'pokerdom')
  upsertRate('2026-09-12', 'USD', 'RUB', Math.round(90 * 10_000), 'pokerdom')
  upsertRate('2026-09-10', 'EUR', 'USD', Math.round(1.1 * 10_000), 'er-api')
  upsertRate('2026-09-11', 'EUR', 'USD', Math.round(1.1 * 10_000), 'er-api')
  upsertRate('2026-09-12', 'EUR', 'USD', Math.round(1.1 * 10_000), 'er-api')
  upsertRate('2026-09-12', 'USD', 'CNY', Math.round(7.2 * 10_000), 'er-api')
})

afterEach(() => resetDbForTests())

function rubToUsd(units: number): number | null {
  // convenience: 3000 RUB @ 90 в‚Ѕ/$ в†’ $33.33 (3333 cents)
  return Math.round((units * 10_000 * 10_000) / (90 * 10_000) / 10_000)
}

const imp = (over: Partial<TournamentImportInput>): TournamentImportInput => ({
  tournamentId: 313_666_547,
  name: 'Daily Turbo 5.50',
  date: '2026-09-12',
  buyin: 5_50,
  result: 8_40,
  rank: 112,
  entrants: 431,
  currency: 'USD',
  ...over
})

describe('tournaments', () => {
  it('saves rows, skips blank (0/0) lines and converts profit to USD', () => {
    const rows = replaceDayTournaments(pokerdon, '2026-09-10', [
      { buyin: 50_00, result: 80_00, currency: 'RUB' },
      { buyin: 0, result: 0, currency: 'RUB' },
      { buyin: 30_00, result: 0, currency: 'RUB' }
    ])
    expect(rows).toHaveLength(2)
    expect(listDayTournaments(pokerdon, '2026-09-10')).toHaveLength(2)
    // +3000 RUB profit в€’ 3000 RUB bust = 0 в†’ 0 USD
    expect(tournamentProfitUsd(rows)).toBe(0)
  })

  it('rejects invalid lines and re-saves replace the day', () => {
    expect(() => replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: -1, result: 0, currency: 'RUB' }])).toThrow(/buyin/)
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'RUB' }])
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 90_00, result: 0, currency: 'RUB' }])
    expect(listDayTournaments(pokerdon, '2026-09-10')).toHaveLength(1)
  })

  it('flags a >5% discrepancy between balance profit and tournament profit', () => {
    // Balance: +$40 profit on the day, no cash flows.
    upsertBalance(pokerdon, '2026-09-09', 100_00, 'USD')
    upsertBalance(pokerdon, '2026-09-10', 140_00, 'USD')
    // One tournament: buyin 50 в†’ 80 RUB = +30 RUB в‰€ $33.33
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'RUB' }])

    const reconcile = reconcileDay(pokerdon, '2026-09-10')
    expect(reconcile.sessionProfitUsd).toBe(40_00)
    expect(reconcile.tournamentProfitUsd).toBe(rubToUsd(30_00))
    expect(reconcile.remainderUsd).toBe(40_00 - reconcile.tournamentProfitUsd)
    expect(reconcile.flagged).toBe(true)
    expect(reconcile.blank).toBeNull()
  })

  it('adjusts the balance so session profit matches tournaments', () => {
    upsertBalance(pokerdon, '2026-09-09', 100_00, 'USD')
    upsertBalance(pokerdon, '2026-09-10', 140_00, 'USD')
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'RUB' }])

    const target = rubToUsd(30_00)
    const reconcile = adjustBalanceToTournaments(pokerdon, '2026-09-10')
    expect(reconcile.sessionProfitUsd).toBe(target)
    expect(reconcile.remainderUsd ?? 1_000_000).toBeLessThan(5)
    expect(reconcile.flagged).toBe(false)
  })

  it('adjusts across a currency switch: the previous balance is converted, not summed', () => {
    // 10 000.00 RUB sits on 09-09, the day under test is denominated in USD
    upsertBalance(pokerdon, '2026-09-09', 10_000_00, 'RUB')
    upsertBalance(pokerdon, '2026-09-10', 200_00, 'USD')
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'RUB' }])

    const target = rubToUsd(30_00) as number
    const reconcile = adjustBalanceToTournaments(pokerdon, '2026-09-10')

    const entry = getBalance(pokerdon, '2026-09-10')
    expect(entry?.currency).toBe('USD')
    // 10 000.00 RUB @ 90 ₽/$ = $111.11 (11 111¢) + the tournament delta — the
    // old code added the raw 1 000 000 kopeks as if they were cents ($10 000)
    expect(entry?.amount).toBe(11_111 + target)
    expect(reconcile.sessionProfitUsd).toBe(target)
    expect(reconcile.remainderUsd ?? 1_000_000).toBeLessThan(5)
    expect(reconcile.flagged).toBe(false)
  })

  it('adjusts an EUR room against a USD snapshot: inverse rates are applied at amount level', () => {
    // only EUR→USD (1.1) is known for the day: 100.00 USD → €90.91
    upsertBalance(redstar, '2026-09-09', 100_00, 'USD')
    upsertBalance(redstar, '2026-09-10', 100_00, 'EUR')
    replaceDayTournaments(redstar, '2026-09-10', [{ buyin: 50_00, result: 50_00, currency: 'EUR' }])

    const reconcile = adjustBalanceToTournaments(redstar, '2026-09-10')

    // nothing to explain on the day, so the adjusted balance IS the previous
    // balance converted into the entry currency
    const entry = getBalance(redstar, '2026-09-10')
    expect(entry?.currency).toBe('EUR')
    expect(entry?.amount).toBe(9091)
    expect(reconcile.remainderUsd ?? 1_000_000).toBeLessThan(5)
    expect(reconcile.flagged).toBe(false)
  })

  it('writes the leftover off to casino and clears the flag', () => {
    upsertBalance(pokerdon, '2026-09-09', 100_00, 'USD')
    upsertBalance(pokerdon, '2026-09-10', 140_00, 'USD')
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'RUB' }])

    const expected = 40_00 - rubToUsd(30_00)!
    const reconcile = writeoffCasinoRemainder(pokerdon, '2026-09-10')
    expect(reconcile.casinoUsd).toBe(expected)
    expect(reconcile.remainderUsd ?? 1_000_000).toBeLessThan(5)
    expect(reconcile.flagged).toBe(false)
    const row = getDb()
      .prepare("SELECT amount, fee, currency, direction FROM transactions WHERE room_id = ? AND date = ? AND type = 'casino'")
      .get(pokerdon, '2026-09-10')
    expect(row).toMatchObject({ amount: expected, fee: 0, currency: 'USD', direction: 'in' })
  })

  it('records a write-off without moving the balance it explains', () => {
    upsertBalance(pokerdon, '2026-09-09', 100_00, 'USD')
    upsertBalance(pokerdon, '2026-09-10', 140_00, 'USD')
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'RUB' }])

    writeoffCasinoRemainder(pokerdon, '2026-09-10')

    // the snapshot already measures this delta: counting it twice would leave the
    // day just as far from reconciled (and the profit of the day wrong by it)
    expect(getBalance(pokerdon, '2026-09-10')?.amount).toBe(140_00)
    expect(reconcileDay(pokerdon, '2026-09-10').sessionProfitUsd).toBe(40_00)
    expect(reconcileDay(pokerdon, '2026-09-10').remainderUsd ?? 1_000_000).toBeLessThan(5)
  })

  it('re-opens a written-off day when the balance moves, and re-closing adds its own row', () => {
    upsertBalance(pokerdon, '2026-09-09', 100_00, 'USD')
    upsertBalance(pokerdon, '2026-09-10', 140_00, 'USD')
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'RUB' }])

    const casinoRows = () =>
      getDb()
        .prepare("SELECT amount FROM transactions WHERE room_id = ? AND date = ? AND type = 'casino' ORDER BY id")
        .all(pokerdon, '2026-09-10') as unknown as { amount: number }[]

    const first = writeoffCasinoRemainder(pokerdon, '2026-09-10')
    expect(first.remainderUsd).toBe(0)
    expect(casinoRows().map((r) => r.amount)).toEqual([40_00 - rubToUsd(30_00)!])

    // a repeat press on an already closed day is a no-op, not a second row
    expect(writeoffCasinoRemainder(pokerdon, '2026-09-10').remainderUsd).toBe(0)
    expect(casinoRows()).toHaveLength(1)

    // a retrospective balance edit is no longer swallowed: the day honestly
    // re-opens with exactly the part nothing explains
    upsertBalance(pokerdon, '2026-09-10', 160_00, 'USD')
    const afterEdit = reconcileDay(pokerdon, '2026-09-10')
    expect(afterEdit.remainderUsd).toBe(20_00)
    expect(afterEdit.flagged).toBe(true)

    // re-closing records the new remainder as its own casino row and leaves the
    // measured balance alone
    expect(writeoffCasinoRemainder(pokerdon, '2026-09-10').remainderUsd).toBe(0)
    expect(casinoRows().map((r) => r.amount)).toEqual([40_00 - rubToUsd(30_00)!, 20_00])
    expect(getBalance(pokerdon, '2026-09-10')?.amount).toBe(160_00)
  })


  it('counts an explicit casino transaction as casino P&L and keeps the day reconciled', () => {
    // the end-of-day balance is recorded after the casino result, so the
    // snapshot already includes it and the casino is not double counted
    createTransaction({ roomId: pokerdon, type: 'casino', amount: -10_00, currency: 'USD', date: '2026-09-10' })
    upsertBalance(pokerdon, '2026-09-09', 100_00, 'USD')
    upsertBalance(pokerdon, '2026-09-10', 90_00, 'USD')

    const reconcile = reconcileDay(pokerdon, '2026-09-10')
    expect(reconcile.sessionProfitUsd).toBe(-10_00)
    expect(reconcile.casinoUsd).toBe(-10_00)
    expect(reconcile.remainderUsd).toBe(0)
    expect(reconcile.flagged).toBe(false)
  })

  it('keeps Mystery Battle Royale money in the day reconcile (MTT + MBR)', () => {
    upsertBalance(pokerdon, '2026-09-09', 100_00, 'USD')
    upsertBalance(pokerdon, '2026-09-10', 104_50, 'USD')
    saveDayBatch(pokerdon, '2026-09-10', [], [
      imp({ tournamentId: 1, date: '2026-09-10', name: 'Daily Turbo 5.50', buyin: 5_50, result: 11_00 }),
      imp({ tournamentId: 2, date: '2026-09-10', name: "Mystery Battle Royale $1, Hold'em No Limit", buyin: 1_00, result: 0, rank: 5, entrants: null })
    ])

    const reconcile = reconcileDay(pokerdon, '2026-09-10')
    // +$5.50 MTT в€’ $1.00 MBR = +$4.50 вЂ” MBR is not dropped from the money side
    expect(reconcile.tournamentProfitUsd).toBe(4_50)
    expect(reconcile.remainderUsd).toBe(0)
    expect(reconcile.flagged).toBe(false)

    const flag = reconcileSummary('2026-09-10', '2026-09-10').find((f) => f.roomId === pokerdon)
    expect(flag?.tournamentCount).toBe(2)
    expect(flag?.flagged).toBe(false)
  })

  it('reconcileSummary scans every day of a range crossing a DST fallback', () => {
    // Europe/Berlin falls back on 2026-10-25: a fixed 24h step from local
    // midnight repeats 10-25 and never reaches 10-28, silently losing its flag
    const dates = ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']
    let balance = 100_00
    for (const date of dates) {
      upsertBalance(pokerdon, date, balance, 'USD')
      balance += 100_00
    }

    const flags = reconcileSummary('2026-10-24', '2026-10-28')
    expect(flags.map((f) => f.date)).toEqual(dates)
  })

  it('editing a past day uses that day frozen rate even when newer rates exist', () => {
    // a "newer" rate exists (e.g. refreshed today) at a different level
    upsertRate('2026-09-16', 'USD', 'RUB', Math.round(100 * 10_000), 'pokerdom')
    upsertBalance(pokerdon, '2026-09-09', 100_00, 'USD')
    upsertBalance(pokerdon, '2026-09-10', 140_00, 'USD')
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'RUB' }])

    const reconcile = reconcileDay(pokerdon, '2026-09-10')
    // +30 RUB frozen at the 09-10 rate (90) в†’ $33.33; at the "newer" 100 rate it would be $30.00
    expect(reconcile.tournamentProfitUsd).toBe(rubToUsd(30_00))
    expect(reconcile.tournamentProfitUsd).not.toBe(30_00)
  })

  it('preview reconciles draft lines without persisting them', () => {
    upsertBalance(pokerdon, '2026-09-09', 100_00, 'USD')
    upsertBalance(pokerdon, '2026-09-10', 140_00, 'USD')

    const { reconcile } = previewDayReconcile(pokerdon, '2026-09-10', [
      { buyin: 50_00, result: 80_00, currency: 'RUB' },
      { buyin: 0, result: 0, currency: 'RUB' }
    ])
    expect(reconcile.tournamentProfitUsd).toBe(rubToUsd(30_00))
    expect(reconcile.flagged).toBe(true)
    expect(listDayTournaments(pokerdon, '2026-09-10')).toHaveLength(0)
    expect(() => previewDayReconcile(pokerdon, '2026-09-10', [{ buyin: -1, result: 0, currency: 'RUB' }])).toThrow(/buyin/)
  })

  it('tournamentsExistMap covers saved room+day pairs only', () => {
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'RUB' }])
    const map = tournamentsExistMap()
    expect(map.has(`${pokerdon}:2026-09-10`)).toBe(true)
    expect(map.has(`${pokerdon}:2026-09-11`)).toBe(false)
    expect(map.has(`${redstar}:2026-09-10`)).toBe(false)
  })

  it('tournamentsExistMap counts MBR-only days too (a played day is played)', () => {
    saveDayBatch(pokerdon, '2026-09-16', [], [
      imp({ tournamentId: 1, date: '2026-09-16', name: "Mystery Battle Royale $1, Hold'em No Limit" })
    ])
    expect(tournamentsExistMap().has(`${pokerdon}:2026-09-16`)).toBe(true)
  })

  it('reconcile needs a balance for the day', () => {
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'RUB' }])
    const reconcile = reconcileDay(pokerdon, '2026-09-10')
    expect(reconcile.blank).toBe('нет баланса за день')
    expect(reconcile.flagged).toBe(false)
  })

  it('summarises discrepancies per day/room, skipping clean days', () => {
    // first-day RedStar balance is explained by a deposit-in в†’ session profit 0 в†’ clean
    createTransaction({ roomId: redstar, type: 'deposit', amount: 100_00, currency: 'EUR', direction: 'in', date: '2026-09-10' })
    upsertBalance(pokerdon, '2026-09-09', 100_00, 'USD')
    upsertBalance(pokerdon, '2026-09-10', 140_00, 'USD')
    upsertBalance(pokerdon, '2026-09-11', 140_00, 'USD')
    upsertBalance(redstar, '2026-09-10', 100_00, 'EUR')
    upsertBalance(redstar, '2026-09-11', 100_00, 'EUR')
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'RUB' }])

    const flags = reconcileSummary('2026-09-10', '2026-09-11')
    // 09-10 pokerdom flagged (delta $40 vs tournaments $33); 09-11 is clean (delta 0),
    // RedStar both days clean в†’ not included.
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatchObject({ date: '2026-09-10', roomId: pokerdon, roomName: 'pokerdom', flagged: true, tournamentCount: 1 })
  })
})

describe('saveDayBatch (GG import)', () => {
  it('upserts by tournament_id across days and dedupes duplicates', () => {
    const batch = saveDayBatch(pokerdon, '2026-09-12', [], [
      imp({}),
      imp({ tournamentId: 313_666_548, name: 'Hyper 2.50', buyin: 2_50, result: 0, rank: null, entrants: null }),
      imp({ result: 12_00 }) // same tournamentId в†’ overwrites 8.40
    ])
    const day09_12 = listDayTournaments(pokerdon, '2026-09-12')
    expect(day09_12).toHaveLength(2)
    const first = day09_12.find((r) => r.tournamentId === 313_666_547)
    expect(first).toMatchObject({ result: 12_00, name: 'Daily Turbo 5.50', rank: 112, entrants: 431 })
    expect(batch.rows.filter((r) => r.tournamentId !== null)).toHaveLength(2)
    expect(batch.reconciles.map((r) => r.date)).toEqual(['2026-09-12'])
  })

  it('splits imported tournaments onto their own true dates', () => {
    const batch = saveDayBatch(pokerdon, '2026-09-12', [], [
      imp({ tournamentId: 1, date: '2026-09-12' }),
      imp({ tournamentId: 2, date: '2026-09-10' })
    ])
    expect(listDayTournaments(pokerdon, '2026-09-12')).toHaveLength(1)
    expect(listDayTournaments(pokerdon, '2026-09-10')).toHaveLength(1)
    expect(batch.reconciles.map((r) => r.date)).toEqual(['2026-09-10', '2026-09-12'])
  })

  it('interpolates a missing balance on the tournament date as auto carry-forward', () => {
    upsertBalance(pokerdon, '2026-09-10', 100_00, 'USD')
    saveDayBatch(pokerdon, '2026-09-12', [], [imp({ tournamentId: 1 })])
    const row = getDb()
      .prepare('SELECT amount, currency, source FROM balance_entries WHERE room_id = ? AND date = ?')
      .get(pokerdon, '2026-09-12') as { amount: number; currency: string; source: string }
    expect(row).toMatchObject({ amount: 100_00, currency: 'USD', source: 'auto' })
  })

  it('re-saving manual lines does not wipe imported rows of the same day', () => {
    saveDayBatch(pokerdon, '2026-09-12', [{ buyin: 3_00, result: 0, currency: 'USD' }], [imp({ tournamentId: 1 })])
    const afterManualReplacement = replaceDayTournaments(pokerdon, '2026-09-12', [{ buyin: 99_00, result: 0, currency: 'USD' }])
    expect(afterManualReplacement).toHaveLength(2)
    expect(afterManualReplacement.filter((r) => r.tournamentId === 1)).toHaveLength(1)
  })

  it('manual lines stay NULL-tournament and imported rows for the modal date coexist', () => {
    const batch = saveDayBatch(pokerdon, '2026-09-12', [{ buyin: 3_00, result: 0, currency: 'USD' }], [imp({ tournamentId: 1 })])
    expect(batch.reconciles.map((r) => r.date)).toEqual(['2026-09-12'])
    // 3.00 bust = в€’$3 ; imported 8.40 win on 5.50 = +$2.90 в†’ $в€’0.10 total
    expect(batch.reconciles[0]!.tournamentProfitUsd).toBe(-10)
  })

  it('converts imported CNY profits with the frozen rate of the tournament date', () => {
    upsertBalance(pokerdon, '2026-09-11', 100_00, 'USD')
    const cny = imp({
      tournamentId: 7,
      date: '2026-09-12',
      currency: 'CNY',
      buyin: 5_00,
      result: 7_20
    })
    const rows = saveDayBatch(pokerdon, '2026-09-12', [], [cny]).rows.filter((r) => r.tournamentId === 7)
    // +2.20 ВҐ at 7.2 ВҐ/$ в†’ +$0.31 (31/100)
    expect(tournamentProfitUsd(rows)).toBe(31)
    // a "newer" rate on a later date must not leak into the frozen 09-12 conversion
    upsertRate('2026-09-16', 'USD', 'CNY', Math.round(9.9 * 10_000), 'er-api')
    expect(tournamentProfitUsd(rows)).toBe(31)
  })

  it('rejects malformed imported rows before writing anything', () => {
    expect(() => saveDayBatch(pokerdon, '2026-09-12', [], [imp({ tournamentId: -1 })])).toThrow(/tournamentId/)
    expect(() => saveDayBatch(pokerdon, '2026-09-12', [], [imp({ date: 'not-a-date' })])).toThrow(/date/)
    expect(() => saveDayBatch(pokerdon, '2026-09-12', [], [imp({ currency: 'KZT' })])).toThrow(/currency/)
    expect(listDayTournaments(pokerdon, '2026-09-12')).toHaveLength(0)
  })

  it('previewDayReconcile includes imported rows of that day only', () => {
    upsertBalance(pokerdon, '2026-09-12', 100_00, 'USD')
    upsertBalance(pokerdon, '2026-09-11', 100_00, 'USD')
    const { reconcile } = previewDayReconcile(
      pokerdon,
      '2026-09-12',
      [],
      [imp({ tournamentId: 1, date: '2026-09-12' }), imp({ tournamentId: 2, date: '2026-09-10' })]
    )
    // only the 09-12 imported row counts: +2.90 USD; persist nothing
    expect(reconcile.tournamentProfitUsd).toBe(290)
    expect(listDayTournaments(pokerdon, '2026-09-12')).toHaveLength(0)
  })

  it('previewDayReconcile models the balance re-anchor and reconciles the target day', () => {
    // the exact "записал баланс сегодня, а турниры вчера" scenario: the save
    // pulls the misplaced manual balance onto the import's own day, so the
    // preview must reconcile THAT day — and report the would-be move
    upsertBalance(pokerdon, '2026-09-10', 100_00, 'USD')
    upsertBalance(pokerdon, '2026-09-12', 100_00, 'USD')
    // play day carries its deposit flow + the tournament (allowed — it is not in
    // the (target, from] gap), so the projected session exactly cancels the buyin
    createTransaction({ roomId: pokerdon, type: 'deposit', amount: 30_00, currency: 'USD', direction: 'in', date: '2026-09-11' })
    const preview = previewDayReconcile(pokerdon, '2026-09-12', [], [imp({ tournamentId: 9, date: '2026-09-11', buyin: 30_00, result: 0 })])
    expect(preview.wouldReanchor).toEqual({ from: '2026-09-12', to: '2026-09-11' })
    // the projected session on 09-11: balance 100→100 (delta 0), deposit +30 → −30,
    // matches the −30 tournament exactly → nothing left to explain
    expect(preview.reconcile.date).toBe('2026-09-11')
    expect(preview.reconcile.sessionProfitUsd).toBe(-30_00)
    expect(preview.reconcile.tournamentProfitUsd).toBe(-30_00)
    expect(preview.reconcile.remainderUsd).toBe(0)
    expect(preview.reconcile.flagged).toBe(false)
    // preview stays stateless — balances untouched, no tournaments written
    expect(getBalance(pokerdon, '2026-09-12')?.amount).toBe(100_00)
    expect(getBalance(pokerdon, '2026-09-10')?.amount).toBe(100_00)
    expect(listDayTournaments(pokerdon, '2026-09-11')).toHaveLength(0)
  })

  it('flags imported Mystery Battle Royale rows by name and leaves normal rows unflagged', () => {
    const rows = saveDayBatch(pokerdon, '2026-09-16', [{ buyin: 3_00, result: 0, currency: 'USD' }], [
      imp({ tournamentId: 1, date: '2026-09-16', name: 'Mystery Battle Royale $1, Hold\'em No Limit' }),
      imp({ tournamentId: 2, date: '2026-09-16', name: 'Mystery Battle Royale $3, Hold\'em No Limit' }),
      imp({ tournamentId: 3, date: '2026-09-16', name: 'Daily Turbo 5.50' })
    ]).rows
    const flag = (id: number) => rows.find((r) => r.tournamentId === id)?.isMbr
    expect(flag(1)).toBe(true)
    expect(flag(2)).toBe(true)
    expect(flag(3)).toBe(false)
    expect(rows.filter((r) => r.tournamentId === null).every((r) => r.isMbr === false)).toBe(true)
  })

  it('re-importing the same tournamentId with a changed name updates the MBR flag', () => {
    saveDayBatch(pokerdon, '2026-09-16', [], [imp({ tournamentId: 1, date: '2026-09-16', name: 'Mystery Battle Royale $1, Hold\'em No Limit' })])
    expect(listDayTournaments(pokerdon, '2026-09-16')[0]!.isMbr).toBe(true)

    saveDayBatch(pokerdon, '2026-09-16', [], [imp({ tournamentId: 1, date: '2026-09-16', name: 'Daily Turbo 5.50' })])
    const row = listDayTournaments(pokerdon, '2026-09-16')[0]!
    expect(row.isMbr).toBe(false)
    expect(row.name).toBe('Daily Turbo 5.50')
  })

  it('isMbrByName matches the case-insensitive trimmed prefix only', () => {
    expect(isMbrByName('Mystery Battle Royale $1, Hold\'em No Limit')).toBe(true)
    expect(isMbrByName('  mystery battle royale $3')).toBe(true)
    expect(isMbrByName('Daily Mystery Battle Royale')).toBe(false)
    expect(isMbrByName(null)).toBe(false)
  })

  it('converts released text-imported ids to manual lines without duplicates', () => {
    saveDayBatch(pokerdon, '2026-09-16', [], [
      imp({ tournamentId: 111, date: '2026-09-16', buyin: 500_00, result: 128_805, currency: 'RUB' }),
      imp({ tournamentId: 222, date: '2026-09-16', buyin: 250_00, result: 50_00, currency: 'RUB' })
    ])
    expect(listDayTournaments(pokerdon, '2026-09-16')).toHaveLength(2)

    const rows = saveDayBatch(
      pokerdon,
      '2026-09-16',
      [
        { buyin: 500_00, result: 128_805, currency: 'RUB' },
        { buyin: 250_00, result: 75_00, currency: 'RUB' }
      ],
      [],
      [111, 222]
    ).rows
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.tournamentId === null)).toBe(true)
    const saved = listDayTournaments(pokerdon, '2026-09-16')
    expect(saved).toHaveLength(2)
    expect(saved[1]).toMatchObject({ tournamentId: null, buyin: 250_00, result: 75_00 })
  })

  it('releasing an id while re-pasting the same report keeps the import (upsert wins)', () => {
    saveDayBatch(pokerdon, '2026-09-16', [], [imp({ tournamentId: 111, date: '2026-09-16' })])
    const rows = saveDayBatch(pokerdon, '2026-09-16', [{ buyin: 5_50, result: 8_40, currency: 'USD' }], [imp({ tournamentId: 111, date: '2026-09-16' })], [111]).rows
    const byId = (id: number) => rows.filter((r) => r.tournamentId === id).length
    expect(listDayTournaments(pokerdon, '2026-09-16')).toHaveLength(2)
    expect(byId(111)).toBe(1)
  })

  it('ignores unknown released ids twice (idempotent)', () => {
    saveDayBatch(pokerdon, '2026-09-16', [{ buyin: 5_50, result: 0, currency: 'USD' }], [], [999])
    saveDayBatch(pokerdon, '2026-09-16', [{ buyin: 5_50, result: 0, currency: 'USD' }], [], [999])
    expect(listDayTournaments(pokerdon, '2026-09-16')).toHaveLength(1)
  })

  it('rejects non-integer or negative released ids', () => {
    expect(() => saveDayBatch(pokerdon, '2026-09-16', [{ buyin: 1_00, result: 0, currency: 'USD' }], [], [1.5])).toThrow(/removedImportIds/)
    expect(() => saveDayBatch(pokerdon, '2026-09-16', [{ buyin: 1_00, result: 0, currency: 'USD' }], [], [0])).toThrow(/removedImportIds/)
    expect(() => saveDayBatch(pokerdon, '2026-09-16', [{ buyin: 1_00, result: 0, currency: 'USD' }], [], ['x' as unknown as number])).toThrow(/removedImportIds/)
  })
})

describe('deleteImportedTournament', () => {
  it('removes an imported row by (room_id, tournament_id) wherever its date is', () => {
    const room = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    saveDayBatch(room, '2026-09-16', [], [imp({ tournamentId: 5, date: '2026-09-12' })])
    expect(listDayTournaments(room, '2026-09-12')).toHaveLength(1)
    deleteImportedTournament(room, 5)
    expect(listDayTournaments(room, '2026-09-12')).toHaveLength(0)
  })

  it('drops the auto-interpolated balance of a day that loses its only tournament', () => {
    const room = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    upsertBalance(room, '2026-09-10', 200_00, 'USD')
    saveDayBatch(room, '2026-09-12', [], [imp({ tournamentId: 5, date: '2026-09-12' })])
    expect(getDb().prepare('SELECT 1 FROM balance_entries WHERE room_id = ? AND date = ? AND source = ?').get(room, '2026-09-12', 'auto')).toBeDefined()
    deleteImportedTournament(room, 5)
    expect(getDb().prepare('SELECT 1 FROM balance_entries WHERE room_id = ? AND date = ? AND source = ?').get(room, '2026-09-12', 'auto')).toBeUndefined()
  })

  it('rejects a non-integer id', () => {
    expect(() => deleteImportedTournament(pokerdon, 1.5)).toThrow(/tournamentId/)
  })

  it('404s when the imported row is unknown', () => {
    expect(() => deleteImportedTournament(pokerdon, 999)).toThrow(/не найден/)
  })
})