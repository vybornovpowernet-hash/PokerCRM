import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import type { FastifyInstance } from 'fastify'
import { getDb, initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import { createRoom } from '../src/services/rooms.js'
import { createTransaction } from '../src/services/funds.js'
import { upsertBalance } from '../src/services/balances.js'
import { saveDayBatch } from '../src/services/tournaments.js'

let app: FastifyInstance
let room: number

beforeEach(async () => {
  setDbForTests(initDb(':memory:'))
  room = createRoom({ name: 'PokerDom', cashCurrency: 'USD', tournamentCurrency: 'RUB' }).id
  app = await createApp({ logger: false })
})

afterEach(async () => {
  await app.close()
  resetDbForTests()
})

async function listDiscrepancies(query = ''): Promise<{ date: string; roomId: number; roomName: string; amountUsd: number }[]> {
  const res = await app.inject({ method: 'GET', url: `/api/transactions?includeDiscrepancies=1&${query}` })
  expect(res.statusCode).toBe(200)
  return (res.json() as { discrepancies: { date: string; roomId: number; roomName: string; amountUsd: number }[] }).discrepancies
}

describe('orphaned discrepancies in the transactions tab', () => {
  it('surfaces flagged days without an active pending import', async () => {
    upsertBalance(room, '2026-09-09', 100_00, 'USD')
    upsertBalance(room, '2026-09-10', 200_00, 'USD')

    const discrepancies = await listDiscrepancies()
    expect(discrepancies).toHaveLength(1)
    expect(discrepancies[0]).toMatchObject({ date: '2026-09-09', roomId: room, roomName: 'PokerDom', amountUsd: 100_00 })
  })

  it('skips the day currently waiting for an import', async () => {
    upsertBalance(room, '2026-09-09', 100_00, 'USD')
    const discrepancies = await listDiscrepancies()
    expect(discrepancies).toHaveLength(0)
  })

  it('does not compute discrepancies unless requested', async () => {
    upsertBalance(room, '2026-09-09', 100_00, 'USD')
    const res = await app.inject({ method: 'GET', url: '/api/transactions' })
    const body = res.json() as { discrepancies: unknown[] }
    expect(body.discrepancies).toEqual([])
  })

  it('honors room and date range filters', async () => {
    const other = createRoom({ name: 'Bybit', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    upsertBalance(room, '2026-09-08', 100_00, 'USD')
    upsertBalance(room, '2026-09-10', 200_00, 'USD')
    upsertBalance(other, '2026-09-08', 50_00, 'USD')
    upsertBalance(other, '2026-09-11', 60_00, 'USD')

    const byRoom = await listDiscrepancies(`roomId=${room}`)
    expect(byRoom.map((d) => d.date)).toEqual(['2026-09-08'])

    const byDate = await listDiscrepancies('dateFrom=2026-09-08&dateTo=2026-09-08')
    expect(byDate).toHaveLength(2)

    const noHits = await listDiscrepancies('dateFrom=2026-09-09&dateTo=2026-09-09')
    expect(noHits).toHaveLength(0)
  })

  it('exposes pendingImport in current balances', async () => {
    upsertBalance(room, '2026-09-09', 100_00, 'USD')
    const res = await app.inject({ method: 'GET', url: '/api/balances/current' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { balances: Array<{ roomId: number; pendingImport: boolean }> }
    const row = body.balances.find((b) => b.roomId === room)
    expect(row?.pendingImport).toBe(true)
  })
})

describe('POST /api/transactions/writeoff-discrepancy', () => {
  it('closes the flagged day with a casino row carrying the user comment', async () => {
    upsertBalance(room, '2026-09-09', 100_00, 'USD')
    upsertBalance(room, '2026-09-10', 200_00, 'USD')

    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions/writeoff-discrepancy',
      payload: { roomId: room, date: '2026-09-09', comment: '  Играл в крэпс после турнира  ' }
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { reconcile: { remainderUsd: number | null; flagged: boolean } }
    expect(body.reconcile.remainderUsd).toBe(0)
    expect(body.reconcile.flagged).toBe(false)

    const row = getDb()
      .prepare("SELECT amount, fee, currency, direction, comment FROM transactions WHERE room_id = ? AND date = ? AND type = 'casino'")
      .get(room, '2026-09-09')
    expect(row).toMatchObject({
      amount: 100_00,
      fee: 0,
      currency: 'USD',
      direction: 'in',
      comment: 'Играл в крэпс после турнира'
    })

    // the balance already measures this delta — the write-off must not touch it
    expect(getDb().prepare('SELECT amount FROM balance_entries WHERE room_id = ? AND date = ?').get(room, '2026-09-09')).toMatchObject({
      amount: 100_00
    })

    const discrepancies = await listDiscrepancies()
    expect(discrepancies).toHaveLength(0)
  })

  it('re-opens a written-off day after a balance edit and keeps both reasons on record', async () => {
    upsertBalance(room, '2026-09-09', 100_00, 'USD')
    upsertBalance(room, '2026-09-10', 200_00, 'USD')

    const casinoRows = () =>
      getDb()
        .prepare("SELECT amount, comment FROM transactions WHERE room_id = ? AND date = ? AND type = 'casino' ORDER BY id")
        .all(room, '2026-09-09') as unknown as { amount: number; comment: string }[]

    const first = await app.inject({
      method: 'POST',
      url: '/api/transactions/writeoff-discrepancy',
      payload: { roomId: room, date: '2026-09-09', comment: 'Первая версия' }
    })
    expect(first.statusCode).toBe(200)
    expect((first.json() as { reconcile: { remainderUsd: number | null } }).reconcile.remainderUsd).toBe(0)

    upsertBalance(room, '2026-09-09', 150_00, 'USD')

    // the day no longer adds up, and says so instead of staying silently closed
    const open = await listDiscrepancies()
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({ date: '2026-09-09', roomId: room, amountUsd: 50_00 })

    const second = await app.inject({
      method: 'POST',
      url: '/api/transactions/writeoff-discrepancy',
      payload: { roomId: room, date: '2026-09-09', comment: 'Вторая версия' }
    })
    expect(second.statusCode).toBe(200)
    expect((second.json() as { reconcile: { remainderUsd: number | null } }).reconcile.remainderUsd).toBe(0)

    // the correction is its own row: both reasons survive, nothing was overwritten
    expect(casinoRows()).toEqual([
      { amount: 100_00, comment: 'Первая версия' },
      { amount: 50_00, comment: 'Вторая версия' }
    ])
    expect(await listDiscrepancies()).toHaveLength(0)
  })

  it('rejects an empty comment', async () => {
    upsertBalance(room, '2026-09-09', 100_00, 'USD')
    const res = await app.inject({ method: 'POST', url: '/api/transactions/writeoff-discrepancy', payload: { roomId: room, date: '2026-09-09', comment: '   ' } })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: string }).error).toContain('обязательно')
  })

  it('rejects an unknown room and an invalid date', async () => {
    const badRoom = await app.inject({
      method: 'POST',
      url: '/api/transactions/writeoff-discrepancy',
      payload: { roomId: 999, date: '2026-09-09', comment: 'x' }
    })
    expect(badRoom.statusCode).toBe(404)

    const badDate = await app.inject({
      method: 'POST',
      url: '/api/transactions/writeoff-discrepancy',
      payload: { roomId: room, date: 'not-a-date', comment: 'x' }
    })
    expect(badDate.statusCode).toBe(400)
  })
})

/**
 * A write-off is an honest casino row, not a plug over the live ledger. It is
 * created from the residual and never re-pinned, so when the ledger stops
 * adding up — a retrospective tournament import, a balance edit, even a balance
 * edit on a DIFFERENT day that moves the carry-forward base — the day re-opens
 * with exactly the part nothing explains, and re-closing records that part as
 * another row instead of hiding it.
 *
 * The old "smart spring" swallowed those moments, but the remainder it hid was
 * not a rounding artefact: a write-off is a judgement made on the data of the
 * day ("this delta is casino"), and a later import says the judgement was made
 * too early. The honest ledger shows that instead of pinning it away.
 */
describe('A write-off is an honest casino row, not a plug', () => {
  const DATE = '2026-09-10'
  let wallet: number

  beforeEach(() => {
    wallet = createRoom({ name: 'Bybit', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
  })

  interface Reconcile {
    sessionProfitUsd: number | null
    tournamentProfitUsd: number
    casinoUsd: number
    remainderUsd: number | null
    flagged: boolean
  }

  async function reconcile(roomId: number, date = DATE): Promise<Reconcile> {
    const res = await app.inject({ method: 'GET', url: `/api/tournaments/reconcile?roomId=${roomId}&date=${date}` })
    expect(res.statusCode).toBe(200)
    return (res.json() as { reconcile: Reconcile }).reconcile
  }

  /**
   * Dates of the orphaned discrepancies the «Транзакции» tab would surface.
   * 2026-09-09 is a deliberately separate, real gap: the anchor balance has no
   * deposit explaining it, so it stays open for the whole test and proves the
   * write-off is scoped to its own day instead of silencing the room.
   */
  async function openDays(): Promise<string[]> {
    return (await listDiscrepancies()).map((d) => d.date).sort()
  }

  /**
   * Full ledger for 2026-09-10 on a USD room, all movements written BEFORE the
   * day balance so the manual snapshot is never auto-shifted:
   *   deposit +200.00, withdraw −(30.00 + 5.00 fee), transfer out −(20.00 + 1.00 fee),
   *   casino −20.00 (gaming P&L, excluded from the cash flows).
   * Anchors: 09-09 = 100.00, 09-10 = 300.00 → delta 200.00,
   *   flows in 200.00 / out 56.00 → S = 200.00 − 144.00 = 56.00.
   */
  function seedMixedLedger(): void {
    createTransaction({ roomId: room, type: 'deposit', amount: 200_00, currency: 'USD', direction: 'in', date: DATE })
    createTransaction({ roomId: room, type: 'withdraw', amount: 30_00, fee: 5_00, currency: 'USD', direction: 'out', date: DATE })
    createTransaction({ roomId: room, type: 'transfer', amount: 20_00, fee: 1_00, currency: 'USD', destinationRoomId: wallet, date: DATE })
    createTransaction({ roomId: room, type: 'casino', amount: -20_00, currency: 'USD', date: DATE })
    upsertBalance(room, '2026-09-09', 100_00, 'USD')
    upsertBalance(room, DATE, 300_00, 'USD')
    // the transfer receiver is profit-neutral: +20.00 in, +20.00 balance delta
    upsertBalance(wallet, '2026-09-09', 0, 'USD')
    upsertBalance(wallet, DATE, 20_00, 'USD')
  }

  /** «Списать» from the Транзакции tab — the shared closing action. */
  async function writeOff() {
    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions/writeoff-discrepancy',
      payload: { roomId: room, date: DATE, comment: 'Играл в казино' }
    })
    expect(res.statusCode).toBe(200)
    return (res.json() as { reconcile: Reconcile }).reconcile
  }

  const casinoRows = () =>
    getDb()
      .prepare("SELECT amount, fee, currency, direction, comment FROM transactions WHERE room_id = ? AND date = ? AND type = 'casino' ORDER BY id")
      .all(room, DATE) as unknown as { amount: number; fee: number; currency: string; direction: string; comment: string | null }[]

  const casinoAmounts = () => casinoRows().map((r) => r.amount)

  const balanceOf = (date = DATE) =>
    (getDb().prepare('SELECT amount FROM balance_entries WHERE room_id = ? AND date = ?').get(room, date) as { amount: number }).amount

  it('closes the day with a USD casino row and leaves the measured balance alone', async () => {
    seedMixedLedger()

    // 1. the day carries a real, unexplained gap → flagged with a 100% remainder
    const open = await reconcile(room)
    expect(open.sessionProfitUsd).toBe(56_00)
    expect(open.casinoUsd).toBe(-20_00)
    expect(open.remainderUsd).toBe(76_00)
    expect(open.flagged).toBe(true)
    // 09-10 is flagged but still awaits a tournament import, so the tab shows
    // only the unrelated 09-09 gap
    expect(await openDays()).toEqual(['2026-09-09'])
    // the transfer legs themselves stay profit-neutral on the receiving room
    expect((await reconcile(wallet)).remainderUsd).toBe(0)

    // 2. the user closes it deliberately
    expect((await writeOff()).remainderUsd).toBe(0)
    expect(await openDays()).toEqual(['2026-09-09'])

    expect(casinoRows()).toEqual([
      { amount: -20_00, fee: 0, currency: 'USD', direction: 'out', comment: null },
      { amount: 76_00, fee: 0, currency: 'USD', direction: 'in', comment: 'Играл в казино' }
    ])
    // the day's casino P&L is now −20.00 (real) + 76.00 (written off)
    expect((await reconcile(room)).casinoUsd).toBe(56_00)
    // the snapshot already measures that 76.00 — it must not move
    expect(balanceOf()).toBe(300_00)
    expect(balanceOf('2026-09-09')).toBe(100_00)
  })

  it('re-opens when a retrospective tournament import explains part of it', async () => {
    seedMixedLedger()
    await writeOff()

    // 3. the tournament that actually played on that day is imported afterwards
    //    (+56.00 profit) — the write-off was taken with T = 0 and said "the whole
    //    gap is casino", which the import now contradicts
    const imported = await app.inject({
      method: 'POST',
      url: '/api/tournaments/bulk',
      payload: {
        roomId: room,
        date: DATE,
        lines: [],
        imports: [
          {
            tournamentId: 313_666_547,
            name: 'Daily Turbo',
            date: DATE,
            buyin: 100_00,
            result: 156_00,
            rank: 112,
            entrants: 431,
            currency: 'USD'
          }
        ]
      }
    })
    expect(imported.statusCode).toBe(200)

    const afterImport = await reconcile(room)
    expect(afterImport.tournamentProfitUsd).toBe(56_00)
    expect(afterImport.sessionProfitUsd).toBe(56_00)
    expect(afterImport.casinoUsd).toBe(56_00)
    expect(afterImport.remainderUsd).toBe(-56_00)
    expect(afterImport.flagged).toBe(true)

    // re-closing cancels the over-attribution with its own row
    expect((await writeOff()).remainderUsd).toBe(0)
    expect(casinoAmounts()).toEqual([-20_00, 76_00, -56_00])
    expect((await reconcile(room)).casinoUsd).toBe(0)
    expect(balanceOf()).toBe(300_00)
  })

  it('re-opens when a balance edit on ANOTHER day moves the carry-forward base', async () => {
    seedMixedLedger()
    await writeOff()

    // the exact scenario the spring used to bury: the anchor balance of 09-09
    // grows by 30.00, so the day under test now looks 30.00 richer than its
    // casinos can explain
    upsertBalance(room, '2026-09-09', 130_00, 'USD')

    const afterOtherDay = await reconcile(room)
    expect(afterOtherDay.sessionProfitUsd).toBe(26_00)
    expect(afterOtherDay.casinoUsd).toBe(56_00)
    expect(afterOtherDay.remainderUsd).toBe(-30_00)
    expect(afterOtherDay.flagged).toBe(true)
    // 09-10 still awaits an import, so the tab keeps showing only the 09-09 gap
    expect(await openDays()).toEqual(['2026-09-09'])

    expect((await writeOff()).remainderUsd).toBe(0)
    expect(casinoAmounts()).toEqual([-20_00, 76_00, -30_00])
    // neither balance was touched by either write-off
    expect(balanceOf()).toBe(300_00)
    expect(balanceOf('2026-09-09')).toBe(130_00)
  })

  it('re-opens on a same-day balance correction', async () => {
    seedMixedLedger()
    await writeOff()

    upsertBalance(room, DATE, 320_00, 'USD')

    const afterSameDay = await reconcile(room)
    expect(afterSameDay.sessionProfitUsd).toBe(76_00)
    expect(afterSameDay.remainderUsd).toBe(20_00)
    expect(afterSameDay.flagged).toBe(true)

    expect((await writeOff()).remainderUsd).toBe(0)
    expect(casinoAmounts()).toEqual([-20_00, 76_00, 20_00])
    expect(balanceOf()).toBe(320_00)
  })

  it('keeps a casino transaction recorded after the write-off reconciled by itself', async () => {
    seedMixedLedger()
    await writeOff()

    createTransaction({ roomId: room, type: 'casino', amount: -7_00, currency: 'USD', date: DATE })

    // a real operation moves the same-day balance (v18 semantics), so the day
    // nets out on its own — no second row, no re-pinning
    expect(balanceOf()).toBe(293_00)
    const afterCasino = await reconcile(room)
    expect(afterCasino.casinoUsd).toBe(49_00)
    expect(afterCasino.remainderUsd).toBe(0)
    expect(afterCasino.flagged).toBe(false)
    expect(casinoAmounts()).toEqual([-20_00, 76_00, -7_00])
  })

  it('keeps «Поправить баланс» and a repeat «Списать» inert on a closed day', async () => {
    seedMixedLedger()
    await writeOff()

    // nothing left to explain: the target balance equals the measured one
    const adjusted = await app.inject({ method: 'POST', url: '/api/tournaments/adjust-balance', payload: { roomId: room, date: DATE } })
    expect(adjusted.statusCode).toBe(200)
    expect((adjusted.json() as { reconcile: Reconcile }).reconcile.remainderUsd).toBe(0)
    expect(balanceOf()).toBe(300_00)

    // a repeat press writes no row and overwrites no comment
    const again = await app.inject({ method: 'POST', url: '/api/tournaments/writeoff', payload: { roomId: room, date: DATE } })
    expect(again.statusCode).toBe(200)
    expect((again.json() as { reconcile: Reconcile }).reconcile.remainderUsd).toBe(0)
    expect(casinoAmounts()).toEqual([-20_00, 76_00])
    expect(casinoRows()[1]).toMatchObject({ comment: 'Играл в казино' })
    expect(await openDays()).toEqual(['2026-09-09'])
  })
})

/**
 * An interpolated balance ('auto' carry-forward) replays deposits, withdrawals
 * and casino P&L but NOT tournament results, so on such a day `S = X` and the
 * residual collapses to `R ≡ −T`: a 100% phantom that no write-off can
 * honestly close (no measured balance to explain). A discrepancy is therefore
 * only ever raised for days the user actually measured — until a manual
 * balance lands, the day carries no remainder and no flag.
 */
describe('auto-interpolated balance: no phantom discrepancy', () => {
  const ANCHOR = '2026-09-08'
  const DATE = '2026-09-10'
  let roomId: number

  interface Reconcile {
    sessionProfitUsd: number | null
    tournamentProfitUsd: number
    casinoUsd: number
    remainderUsd: number | null
    discrepancyPct: number | null
    flagged: boolean
    blank: string | null
  }

  async function reconcile(date = DATE): Promise<Reconcile> {
    const res = await app.inject({ method: 'GET', url: `/api/tournaments/reconcile?roomId=${roomId}&date=${date}` })
    expect(res.statusCode).toBe(200)
    return (res.json() as { reconcile: Reconcile }).reconcile
  }

  function balanceSource(date: string): string | undefined {
    return (getDb().prepare('SELECT source FROM balance_entries WHERE room_id = ? AND date = ?').get(roomId, date) as
      | { source: string }
      | undefined)?.source
  }

  beforeEach(() => {
    // the room is created by the outer beforeEach; give it an anchor day the
    // user measured, then leave DATE with only what the import interpolates
    roomId = room
    createTransaction({ roomId, type: 'deposit', amount: 100_00, currency: 'USD', direction: 'in', date: ANCHOR })
    upsertBalance(roomId, ANCHOR, 100_00, 'USD')
    createTransaction({ roomId, type: 'deposit', amount: 50_00, currency: 'USD', direction: 'in', date: DATE })
    saveDayBatch(roomId, DATE, [], [
      {
        tournamentId: 555_01,
        name: 'Daily Turbo',
        date: DATE,
        buyin: 100_00,
        result: 0,
        rank: null,
        entrants: 200,
        currency: 'USD'
      }
    ])
  })

  it('reports no remainder and no flag for a day whose balance is interpolated', async () => {
    // the import interpolated the day: carry-forward + deposit, no user input
    expect(balanceSource(DATE)).toBe('auto')

    const day = await reconcile()
    // the numbers are all there — only the comparison is withheld
    expect(day.tournamentProfitUsd).toBe(-100_00)
    expect(day.sessionProfitUsd).toBe(0)
    expect(day.remainderUsd).toBeNull()
    expect(day.discrepancyPct).toBeNull()
    expect(day.flagged).toBe(false)
    expect(day.blank).toMatch(/ручного баланса/)
    // and nothing is offered to the «Транзакции» tab to be written off
    expect(await listDiscrepancies()).toHaveLength(0)
  })

  it('keeps the sessions badge and the write-off honest for such a day', async () => {
    const flags = await app.inject({ method: 'GET', url: `/api/tournaments/reconcile-summary?dateFrom=${ANCHOR}&dateTo=${DATE}` })
    expect(flags.statusCode).toBe(200)
    const body = flags.json() as { flags: { date: string; flagged: boolean; remainderUsd: number | null; tournamentCount: number }[] }
    const day = body.flags.find((f) => f.date === DATE)
    expect(day).toMatchObject({ flagged: false, remainderUsd: null, tournamentCount: 1 })

    // «Списать» on a day that was never measured is refused, not silently faked
    const writeoff = await app.inject({ method: 'POST', url: '/api/tournaments/writeoff', payload: { roomId, date: DATE } })
    expect(writeoff.statusCode).toBe(400)
    expect((writeoff.json() as { error: string }).error).toMatch(/ручного баланса/)
    const casinoRows = getDb()
      .prepare("SELECT COUNT(*) AS c FROM transactions WHERE room_id = ? AND date = ? AND type = 'casino'")
      .get(roomId, DATE) as { c: number }
    expect(casinoRows.c).toBe(0)
  })

  it('starts reconciling the very same day once the user records its balance', async () => {
    // the tournament lost 100.00, the balance chain claims +0.00 → a real gap
    upsertBalance(roomId, DATE, 150_00, 'USD')
    expect(balanceSource(DATE)).toBe('manual')

    const day = await reconcile()
    expect(day.blank).toBeNull()
    expect(day.remainderUsd).toBe(100_00)
    expect(day.flagged).toBe(true)

    const open = await listDiscrepancies()
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({ date: DATE, roomId, amountUsd: 100_00 })

    // and only now may it be closed
    const writeoff = await app.inject({ method: 'POST', url: '/api/transactions/writeoff-discrepancy', payload: { roomId, date: DATE, comment: 'казино' } })
    expect(writeoff.statusCode).toBe(200)
    expect((writeoff.json() as { reconcile: Reconcile }).reconcile.remainderUsd).toBe(0)
    expect(await listDiscrepancies()).toHaveLength(0)
  })
})
