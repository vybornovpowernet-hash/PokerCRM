import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import type { FastifyInstance } from 'fastify'
import { getDb, initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import { createRoom } from '../src/services/rooms.js'
import { createTransaction } from '../src/services/funds.js'
import { upsertBalance } from '../src/services/balances.js'
import { sessionsInRange } from '../src/services/sessions.js'

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

interface Reanchored {
  from: string
  to: string
}

function ggImport(date: string, tournamentId: number) {
  return { tournamentId, name: 'Daily Turbo', date, buyin: 100_00, result: 150_00, rank: 10, entrants: 100, currency: 'USD' }
}

async function save(payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/tournaments/bulk', payload: { roomId: room, ...payload } })
}

function balanceRow(date: string): { amount: number; source: string } | undefined {
  return getDb()
    .prepare('SELECT amount, source FROM balance_entries WHERE room_id = ? AND date = ?')
    .get(room, date) as { amount: number; source: string } | undefined
}

function tournamentCount(date: string): number {
  return (getDb().prepare('SELECT COUNT(*) AS c FROM tournaments WHERE room_id = ? AND date = ?').get(room, date) as { c: number }).c
}

function pendingCount(): number {
  return (getDb().prepare('SELECT COUNT(*) AS c FROM pending_imports WHERE room_id = ?').get(room) as { c: number }).c
}

/**
 * The phantom-session bug: a balance recorded "today" (the form has no date
 * field) while the play happened on the import's own dates. The save must
 * re-anchor the balance to the last day of the import so the sessions collapse
 * onto the play day — with guards keeping every other scenario untouched.
 */
describe('Re-anchor balance to import dates on save', () => {
  it('moves the misplaced manual balance to the last import day and collapses the sessions', async () => {
    upsertBalance(room, '2026-09-10', 1000_00, 'USD')
    upsertBalance(room, '2026-09-20', 800_00, 'USD')
    // a balance day without tournaments arms the "Заполнить турниры" marker
    expect(pendingCount()).toBe(1)

    const res = await save({ date: '2026-09-20', lines: [], imports: [ggImport('2026-09-15', 501)] })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { reanchored: Reanchored | null }
    expect(body.reanchored).toEqual({ from: '2026-09-20', to: '2026-09-15' })

    expect(balanceRow('2026-09-20')).toBeUndefined()
    expect(balanceRow('2026-09-15')).toEqual({ amount: 800_00, source: 'manual' })
    expect(tournamentCount('2026-09-15')).toBe(1)

    const days = sessionsInRange('2026-09-01', '2026-09-30').map((d) => d.date)
    expect(days).toContain('2026-09-10')
    expect(days).toContain('2026-09-15')
    expect(days).not.toContain('2026-09-20')

    expect(pendingCount()).toBe(0)
  })

  it('keeps the balance when a transaction sits between the import day and the balance day', async () => {
    upsertBalance(room, '2026-09-10', 1000_00, 'USD')
    upsertBalance(room, '2026-09-20', 800_00, 'USD')
    createTransaction({ roomId: room, type: 'deposit', amount: 50_00, currency: 'USD', direction: 'in', date: '2026-09-18' })

    const res = await save({ date: '2026-09-20', lines: [], imports: [ggImport('2026-09-15', 502)] })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { reanchored: Reanchored | null }).reanchored).toBeNull()

    expect(balanceRow('2026-09-20')).toEqual({ amount: 800_00, source: 'manual' })
    expect(balanceRow('2026-09-15')?.source).toBe('auto')
  })

  it('keeps the balance when tournaments exist after the batch (retrospective import)', async () => {
    upsertBalance(room, '2026-09-10', 1000_00, 'USD')
    upsertBalance(room, '2026-09-20', 800_00, 'USD')
    getDb()
      .prepare('INSERT INTO tournaments (room_id, date, buyin, result, currency) VALUES (?, ?, ?, ?, ?)')
      .run(room, '2026-09-25', 100_00, 0, 'USD')

    const res = await save({ date: '2026-09-20', lines: [], imports: [ggImport('2026-09-15', 503)] })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { reanchored: Reanchored | null }).reanchored).toBeNull()
    expect(balanceRow('2026-09-20')).toEqual({ amount: 800_00, source: 'manual' })
  })

  it('keeps the balance when the batch also writes manual lines on the balance day', async () => {
    upsertBalance(room, '2026-09-10', 1000_00, 'USD')
    upsertBalance(room, '2026-09-20', 800_00, 'USD')

    const res = await save({
      date: '2026-09-20',
      lines: [{ buyin: 100_00, result: 150_00, currency: 'USD' }],
      imports: [ggImport('2026-09-15', 504)]
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { reanchored: Reanchored | null }).reanchored).toBeNull()
    expect(balanceRow('2026-09-20')).toEqual({ amount: 800_00, source: 'manual' })
    expect(tournamentCount('2026-09-20')).toBe(1)
  })

  it('skips the move when a manual anchor already sits on the target day', async () => {
    upsertBalance(room, '2026-09-10', 1000_00, 'USD')
    upsertBalance(room, '2026-09-15', 900_00, 'USD')
    upsertBalance(room, '2026-09-20', 800_00, 'USD')

    const res = await save({ date: '2026-09-20', lines: [], imports: [ggImport('2026-09-15', 505)] })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { reanchored: Reanchored | null }).reanchored).toBeNull()
    expect(balanceRow('2026-09-20')).toEqual({ amount: 800_00, source: 'manual' })
    expect(balanceRow('2026-09-15')).toEqual({ amount: 900_00, source: 'manual' })
  })

  it('never moves anything for a manual-only save (manual rows own their entry date)', async () => {
    upsertBalance(room, '2026-09-10', 1000_00, 'USD')
    upsertBalance(room, '2026-09-20', 800_00, 'USD')

    const res = await save({
      date: '2026-09-15',
      lines: [{ buyin: 100_00, result: 150_00, currency: 'USD' }],
      imports: []
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { reanchored: Reanchored | null }).reanchored).toBeNull()
    expect(balanceRow('2026-09-20')).toEqual({ amount: 800_00, source: 'manual' })
  })

  it('leaves the write-off flow on its original behaviour: a write-off never re-dates the balance', async () => {
    upsertBalance(room, '2026-09-10', 1000_00, 'USD')
    upsertBalance(room, '2026-09-20', 1200_00, 'USD')

    const res = await save({ date: '2026-09-20', lines: [], imports: [ggImport('2026-09-15', 506)], writeoff: true })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { reanchored: Reanchored | null }).reanchored).toBeNull()

    expect(balanceRow('2026-09-20')).toEqual({ amount: 1200_00, source: 'manual' })
    const casino = getDb()
      .prepare("SELECT amount FROM transactions WHERE room_id = ? AND date = ? AND type = 'casino'")
      .all(room, '2026-09-20') as unknown as { amount: number }[]
    expect(casino).toEqual([{ amount: 200_00 }])
  })
})
