import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import type { FastifyInstance } from 'fastify'
import { getDb, initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import { createRoom } from '../src/services/rooms.js'
import { createTransaction } from '../src/services/funds.js'
import { upsertBalance } from '../src/services/balances.js'

let app: FastifyInstance
let room: number

beforeEach(async () => {
  setDbForTests(initDb(':memory:'))
  room = createRoom({ name: 'GGpoker', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
  app = await createApp({ logger: false })
})

afterEach(async () => {
  await app.close()
  resetDbForTests()
})

interface Reconcile {
  date: string
  sessionProfitUsd: number | null
  tournamentProfitUsd: number
  casinoUsd: number
  remainderUsd: number | null
  discrepancyPct: number | null
  flagged: boolean
  blank: string | null
}

async function reconcile(date: string, roomId = room): Promise<Reconcile> {
  const res = await app.inject({ method: 'GET', url: `/api/tournaments/reconcile?roomId=${roomId}&date=${date}` })
  expect(res.statusCode).toBe(200)
  return (res.json() as { reconcile: Reconcile }).reconcile
}

async function discrepancies(): Promise<{ date: string; roomId: number; amountUsd: number }[]> {
  const res = await app.inject({ method: 'GET', url: '/api/transactions?includeDiscrepancies=1' })
  expect(res.statusCode).toBe(200)
  return (res.json() as { discrepancies: { date: string; roomId: number; amountUsd: number }[] }).discrepancies
}

function ggImport(date: string, tournamentId: number, buyin: number, result: number) {
  return { tournamentId, name: 'Daily Turbo', date, buyin, result, rank: 10, entrants: 100, currency: 'USD' }
}

interface CasinoRow {
  amount: number
  fee: number
  currency: string
  direction: string
  comment: string | null
}

function casinoRows(roomId: number, date: string): CasinoRow[] {
  return getDb()
    .prepare("SELECT amount, fee, currency, direction, comment FROM transactions WHERE room_id = ? AND date = ? AND type = 'casino' ORDER BY id")
    .all(roomId, date) as unknown as CasinoRow[]
}

function balanceOf(roomId: number, date: string): number | undefined {
  return (getDb().prepare('SELECT amount FROM balance_entries WHERE room_id = ? AND date = ?').get(roomId, date) as { amount: number } | undefined)
    ?.amount
}

/**
 * 09-08 anchor: a deposit explains the whole balance, so the day reconciles to
 * zero and never shows up as an orphan. 09-10 is the day under test: its manual
 * balance is 200.00 above the anchor with no deposit, so without tournaments the
 * session claims +200.00 of unexplained profit.
 */
function seedLedger(roomId: number, days: string[] = ['2026-09-08', '2026-09-10']): void {
  createTransaction({ roomId, type: 'deposit', amount: 100_00, currency: 'USD', direction: 'in', date: '2026-09-08' })
  upsertBalance(roomId, days[0] as string, 100_00, 'USD')
  upsertBalance(roomId, days[1] as string, 300_00, 'USD')
}

async function saveWithWriteoff(roomId: number, date: string, imports: ReturnType<typeof ggImport>[]) {
  return app.inject({
    method: 'POST',
    url: '/api/tournaments/bulk',
    payload: { roomId, date, lines: [], imports, writeoffCasino: true }
  })
}

describe('Import flow write-off: «Списать на казино» from the tournament popup', () => {
  it('closes the modal day in the very same request that saves the import', async () => {
    seedLedger(room)

    // 1. «Проверить» with a not-yet-saved import → the day is flagged
    const preview = await app.inject({
      method: 'POST',
      url: '/api/tournaments/preview',
      payload: { roomId: room, date: '2026-09-10', lines: [], imports: [ggImport('2026-09-10', 313_666_547, 100_00, 100_00)] }
    })
    expect(preview.statusCode).toBe(200)
    const flaggedPreview = (preview.json() as { reconcile: Reconcile }).reconcile
    expect(flaggedPreview.flagged).toBe(true)
    expect(flaggedPreview.remainderUsd).toBe(200_00)

    // 2. one request saves the import AND books the casino row that closes it
    const bulk = await saveWithWriteoff(room, '2026-09-10', [ggImport('2026-09-10', 313_666_547, 100_00, 100_00)])
    expect(bulk.statusCode).toBe(200)

    // the response already carries the closed day — no follow-up round-trip
    const closed = (bulk.json() as { reconcile: Reconcile }).reconcile
    expect(closed.remainderUsd).toBe(0)
    expect(closed.flagged).toBe(false)

    // the import landed …
    const stored = getDb().prepare('SELECT COUNT(*) AS c FROM tournaments WHERE room_id = ?').get(room) as { c: number }
    expect(stored.c).toBe(1)

    // … together with the casino row, pinned to the residual the ledger left over
    expect(casinoRows(room, '2026-09-10')).toEqual([
      { amount: 200_00, fee: 0, currency: 'USD', direction: 'in', comment: expect.stringContaining('Авто-списание') }
    ])
    // the manual snapshot already measures that 200.00 and stays untouched
    expect(balanceOf(room, '2026-09-10')).toBe(300_00)

    // 3. nothing is left hanging in the Транзакции tab
    expect(await discrepancies()).toEqual([])
  })

  it('keeps the day open when the batch carries no write-off flag', async () => {
    seedLedger(room)

    const bulk = await app.inject({
      method: 'POST',
      url: '/api/tournaments/bulk',
      payload: { roomId: room, date: '2026-09-10', lines: [], imports: [ggImport('2026-09-10', 313_666_547, 100_00, 100_00)] }
    })
    expect(bulk.statusCode).toBe(200)

    const saved = (bulk.json() as { reconcile: Reconcile }).reconcile
    expect(saved.flagged).toBe(true)
    expect(saved.remainderUsd).toBe(200_00)
    expect(casinoRows(room, '2026-09-10')).toEqual([])
  })

  it('rolls the whole batch back when the day cannot be reconciled', async () => {
    // the archive holds a game from 09-09 while the popup's day 09-10 has no balance of its own
    seedLedger(room, ['2026-09-08', '2026-09-10'])
    getDb().prepare("DELETE FROM balance_entries WHERE room_id = ? AND date = '2026-09-10'").run(room)

    const bulk = await saveWithWriteoff(room, '2026-09-10', [ggImport('2026-09-09', 313_666_548, 50_00, 0)])
    expect(bulk.statusCode).toBe(400)
    expect((bulk.json() as { error: string }).error).toBe('нет баланса за день')

    // atomic: the import of 09-09 is not left behind half-saved
    const stored = getDb().prepare('SELECT COUNT(*) AS c FROM tournaments WHERE room_id = ?').get(room) as { c: number }
    expect(stored.c).toBe(0)
    expect(casinoRows(room, '2026-09-10')).toEqual([])
  })

  it('leaves the same result as the «Списать» button of the Транзакции tab', async () => {
    const other = createRoom({ name: 'RedStar', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    seedLedger(room)
    seedLedger(other)
    const imports = [ggImport('2026-09-10', 313_666_549, 100_00, 100_00)]

    const popup = await saveWithWriteoff(room, '2026-09-10', imports)
    expect(popup.statusCode).toBe(200)

    const tab = await app.inject({
      method: 'POST',
      url: '/api/tournaments/bulk',
      payload: { roomId: other, date: '2026-09-10', lines: [], imports: [ggImport('2026-09-10', 313_666_550, 100_00, 100_00)] }
    })
    expect(tab.statusCode).toBe(200)
    const closed = await app.inject({
      method: 'POST',
      url: '/api/transactions/writeoff-discrepancy',
      payload: { roomId: other, date: '2026-09-10', comment: 'казино' }
    })
    expect(closed.statusCode).toBe(200)

    const popupReconcile = (popup.json() as { reconcile: Reconcile }).reconcile
    const tabReconcile = (closed.json() as { reconcile: Reconcile }).reconcile
    expect({ ...popupReconcile, roomId: 0, roomName: '' }).toEqual({ ...tabReconcile, roomId: 0, roomName: '' })

    const [popupRow] = casinoRows(room, '2026-09-10')
    const [tabRow] = casinoRows(other, '2026-09-10')
    expect({ ...popupRow, comment: null }).toEqual({ ...tabRow, comment: null })
    // only the comment differs: the popup names the reason itself, the tab asks for it
    expect(popupRow?.comment).toContain('Авто-списание')
    expect(tabRow?.comment).toBe('казино')
    expect(balanceOf(room, '2026-09-10')).toBe(300_00)
    expect(balanceOf(other, '2026-09-10')).toBe(300_00)
  })
})

describe('Bulk pipeline: balance and tournaments first, write-off last, all in one request', () => {
  it('books the casino row through the public API: deposit + balances + preview + one bulk with writeoffCasino', async () => {
    // the way the UI does it: a deposit on the Транзакции tab …
    const dep = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      payload: { roomId: room, type: 'deposit', amount: 100_00, currency: 'USD', direction: 'in', date: '2026-09-08' }
    })
    expect(dep.statusCode).toBe(200)

    // … two snapshots on the Баланс tab …
    for (const [date, amount] of [['2026-09-08', 100_00], ['2026-09-10', 300_00]] as const) {
      const res = await app.inject({ method: 'PUT', url: '/api/balances', payload: { roomId: room, date, amount, currency: 'USD' } })
      expect(res.statusCode).toBe(200)
    }

    // … «Проверить» in the popup flags the day …
    const preview = await app.inject({
      method: 'POST',
      url: '/api/tournaments/preview',
      payload: { roomId: room, date: '2026-09-10', lines: [], imports: [ggImport('2026-09-10', 313_666_551, 100_00, 100_00)] }
    })
    expect(preview.statusCode).toBe(200)
    const flagged = (preview.json() as { reconcile: Reconcile }).reconcile
    expect(flagged.flagged).toBe(true)
    expect(flagged.remainderUsd).toBe(200_00)

    // … and «Списать на казино» saves the import and books the write-off in one request
    const bulk = await saveWithWriteoff(room, '2026-09-10', [ggImport('2026-09-10', 313_666_551, 100_00, 100_00)])
    expect(bulk.statusCode).toBe(200)
    expect(casinoRows(room, '2026-09-10')).toEqual([
      { amount: 200_00, fee: 0, currency: 'USD', direction: 'in', comment: expect.stringContaining('Авто-списание') }
    ])
    expect(balanceOf(room, '2026-09-10')).toBe(300_00)
    const closed = (bulk.json() as { reconcile: Reconcile }).reconcile
    expect(closed.remainderUsd).toBe(0)
    expect(closed.flagged).toBe(false)

    // the Транзакции tab shows the row — history must not stay empty after a write-off
    const history = await app.inject({ method: 'GET', url: `/api/transactions?type=casino&roomId=${room}` })
    expect(history.statusCode).toBe(200)
    const rows = (history.json() as { transactions: { date: string; amount: number }[] }).transactions
    expect(rows.filter((t) => t.date === '2026-09-10')).toHaveLength(1)
    expect(await discrepancies()).toEqual([])
  })

  it('write-off on the balance day with a past-only archive: the row lands on the modal day and the balance stays put', async () => {
    seedLedger(room)

    // the archive only holds yesterday's game; the popup's day is where the balance sits
    const bulk = await saveWithWriteoff(room, '2026-09-10', [ggImport('2026-09-09', 313_666_552, 50_00, 0)])
    expect(bulk.statusCode).toBe(200)

    // no tournaments on the modal day → the whole session surplus is written off there
    expect(casinoRows(room, '2026-09-10')).toEqual([
      { amount: 200_00, fee: 0, currency: 'USD', direction: 'in', comment: expect.stringContaining('Авто-списание') }
    ])
    // the write-off row itself blocks re-anchoring: «Списать» never moves the balance
    expect(balanceOf(room, '2026-09-10')).toBe(300_00)
    expect((bulk.json() as { reanchored: { from: string; to: string } | null }).reanchored).toBeNull()

    const closed = (bulk.json() as { reconcile: Reconcile }).reconcile
    expect(closed.remainderUsd).toBe(0)
    expect(await discrepancies()).toEqual([])
  })

  it('write-off still works after a previous save re-anchored the balance onto the play day', async () => {
    seedLedger(room, ['2026-09-08', '2026-09-12'])

    // first save without a write-off: the import of 09-10 pulls the balance from 09-12 onto 09-10
    const first = await app.inject({
      method: 'POST',
      url: '/api/tournaments/bulk',
      payload: { roomId: room, date: '2026-09-10', lines: [], imports: [ggImport('2026-09-10', 313_666_553, 100_00, 100_00)] }
    })
    expect(first.statusCode).toBe(200)
    expect((first.json() as { reanchored: { from: string; to: string } | null }).reanchored).toEqual({
      from: '2026-09-12',
      to: '2026-09-10'
    })
    expect(balanceOf(room, '2026-09-10')).toBe(300_00)
    expect(balanceOf(room, '2026-09-12')).toBeUndefined()

    // the day the balance now sits on is flagged …
    const flaggedDay = await reconcile('2026-09-10')
    expect(flaggedDay.flagged).toBe(true)
    expect(flaggedDay.remainderUsd).toBe(200_00)

    // … so the next popup session can «Списать» and the row still lands in transactions
    const bulk = await saveWithWriteoff(room, '2026-09-10', [ggImport('2026-09-10', 313_666_554, 100_00, 100_00)])
    expect(bulk.statusCode).toBe(200)
    expect(casinoRows(room, '2026-09-10')).toEqual([
      { amount: 200_00, fee: 0, currency: 'USD', direction: 'in', comment: expect.stringContaining('Авто-списание') }
    ])
    expect((bulk.json() as { reanchored: { from: string; to: string } | null }).reanchored).toBeNull()
    expect(balanceOf(room, '2026-09-10')).toBe(300_00)
    expect(await reconcile('2026-09-10')).toMatchObject({ remainderUsd: 0, flagged: false })
    expect(await discrepancies()).toEqual([])
  })
})
