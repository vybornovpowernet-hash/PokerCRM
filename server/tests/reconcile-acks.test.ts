import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../src/app.js'
import { getDb, initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import { createRoom } from '../src/services/rooms.js'
import { upsertBalance } from '../src/services/balances.js'
import { reconcileDay, reconcileSummary, replaceDayTournaments } from '../src/services/tournaments.js'
import { sessionsInRange } from '../src/services/sessions.js'

let app: FastifyInstance
let room: number

beforeEach(async () => {
  setDbForTests(initDb(':memory:'))
  room = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
  app = await createApp({ logger: false })
})

afterEach(async () => {
  await app.close()
  resetDbForTests()
})

/**
 * 10-19 is the day under test: a measured balance of 200.00, one 100.00 buy-in
 * with no payout, so `S = 200.00`, `T = −100.00`, `R = 300.00` — well past the
 * 5% tolerance. The balance on 10-20 moves the pending-import marker off the
 * tested day (otherwise `orphanedDiscrepancies` would hide it for another
 * reason and the test would pass without the acknowledgement doing anything).
 */
function seedFlaggedDay(): void {
  upsertBalance(room, '2026-10-18', 0, 'USD')
  upsertBalance(room, '2026-10-19', 200_00, 'USD')
  replaceDayTournaments(room, '2026-10-19', [{ buyin: 100_00, result: 0, currency: 'USD' }])
  upsertBalance(room, '2026-10-20', 200_00, 'USD')
}

const ack = (date = '2026-10-19', note?: string) =>
  app.inject({ method: 'POST', url: '/api/tournaments/acknowledge-discrepancy', payload: { roomId: room, date, note } })

const revoke = (date = '2026-10-19') =>
  app.inject({ method: 'DELETE', url: '/api/tournaments/acknowledge-discrepancy', payload: { roomId: room, date } })

async function discrepancies(): Promise<{ date: string; amountUsd: number }[]> {
  const res = await app.inject({ method: 'GET', url: '/api/transactions?includeDiscrepancies=1' })
  expect(res.statusCode).toBe(200)
  return (res.json() as { discrepancies: { date: string; amountUsd: number }[] }).discrepancies
}

function casinoRows(): number {
  return (getDb().prepare("SELECT COUNT(*) AS c FROM transactions WHERE type = 'casino'").get() as { c: number }).c
}

describe('acknowledging a discrepancy instead of writing it off', () => {
  it('suppresses the flag without writing a single transaction', async () => {
    seedFlaggedDay()
    expect(reconcileDay(room, '2026-10-19')).toMatchObject({ flagged: true, acknowledged: false, remainderUsd: 300_00 })
    expect(await discrepancies()).toEqual([{ date: '2026-10-19', roomId: room, roomName: 'GG', amountUsd: 300_00 }])

    const res = await ack()
    expect(res.statusCode).toBe(200)
    expect((res.json() as { reconcile: unknown }).reconcile).toMatchObject({
      flagged: false,
      acknowledged: true,
      remainderUsd: 300_00
    })

    // no fake casino row and the measured balance is untouched
    expect(casinoRows()).toBe(0)
    expect(getDb().prepare('SELECT amount FROM balance_entries WHERE room_id = ? AND date = ?').get(room, '2026-10-19')).toMatchObject({
      amount: 200_00
    })
    expect((await discrepancies())).toEqual([])

    // the day stays visible to «Сессии» (it has tournaments) but is not flagged
    const summary = reconcileSummary('2026-10-18', '2026-10-20')
    expect(summary.find((f) => f.date === '2026-10-19')).toMatchObject({
      flagged: false,
      acknowledged: true,
      remainderUsd: 300_00,
      tournamentCount: 1
    })
  })

  it('brings the flag back when the math moves — an acknowledgement never rots silently', async () => {
    seedFlaggedDay()
    await ack()

    // a balance correction changes the residual: the accepted 300.00 no longer
    // describes the day, so the forgiveness must not apply
    upsertBalance(room, '2026-10-19', 250_00, 'USD')

    const day = reconcileDay(room, '2026-10-19')
    expect(day).toMatchObject({ flagged: true, acknowledged: false, remainderUsd: 350_00 })
    expect(await discrepancies()).toEqual([{ date: '2026-10-19', roomId: room, roomName: 'GG', amountUsd: 350_00 }])

    // accepting again stores the new residual (and keeps an earlier note)
    expect((await ack('2026-10-19', 'не объясняется турнирами')).statusCode).toBe(200)
    expect((await ack()).statusCode).toBe(200)
    expect(getDb().prepare('SELECT remainder_usd, note FROM reconcile_acks WHERE room_id = ? AND date = ?').get(room, '2026-10-19')).toMatchObject({
      remainder_usd: 350_00,
      note: 'не объясняется турнирами'
    })
    expect(reconcileDay(room, '2026-10-19')).toMatchObject({ flagged: false, acknowledged: true })
  })

  it('can be revoked, which re-flags the day immediately', async () => {
    seedFlaggedDay()
    await ack()
    expect(reconcileDay(room, '2026-10-19').flagged).toBe(false)

    const res = await revoke()
    expect(res.statusCode).toBe(200)
    expect((res.json() as { reconcile: unknown }).reconcile).toMatchObject({ flagged: true, acknowledged: false, remainderUsd: 300_00 })
    expect(await discrepancies()).toHaveLength(1)

    // nothing left to revoke
    expect((await revoke()).statusCode).toBe(404)
  })

  it('refuses days with nothing to accept and over-long notes', async () => {
    seedFlaggedDay()

    const noBalance = await ack('2026-10-21')
    expect(noBalance.statusCode).toBe(400)
    expect((noBalance.json() as { error: string }).error).toMatch(/нет баланса/)

    const tooLong = await ack('2026-10-19', 'x'.repeat(501))
    expect(tooLong.statusCode).toBe(400)
    expect((tooLong.json() as { error: string }).error).toMatch(/500/)

    // an empty note is fine: the decision itself is the record
    expect((await ack('2026-10-19', '   ')).statusCode).toBe(200)
  })

  it('refuses a day that is within the 5% tolerance', async () => {
    upsertBalance(room, '2026-10-18', 0, 'USD')
    upsertBalance(room, '2026-10-19', 100_00, 'USD')
    replaceDayTournaments(room, '2026-10-19', [{ buyin: 0, result: 100_00, currency: 'USD' }])

    expect(reconcileDay(room, '2026-10-19')).toMatchObject({ flagged: false, remainderUsd: 0 })
    const res = await ack()
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: string }).error).toMatch(/Расхождения нет/)
  })
})

describe('sessions: an acknowledged residual is not poker profit', () => {
  function sessionDay(date: string) {
    return sessionsInRange('2026-10-18', '2026-10-20').find((d) => d.date === date)
  }

  it('shows only real tournament results and drops the phantom loss', async () => {
    upsertBalance(room, '2026-10-18', 0, 'USD')
    upsertBalance(room, '2026-10-19', 300_00, 'USD')
    replaceDayTournaments(room, '2026-10-19', [{ buyin: 100_00, result: 103_00, currency: 'USD' }])

    // before the acknowledgement the whole balance result sits in the profit column
    expect(sessionDay('2026-10-19')?.rooms[0]).toMatchObject({
      profitUsd: 300_00,
      casinoUsd: 0,
      acknowledgedUsd: 0,
      pokerProfitUsd: 300_00
    })
    expect(sessionDay('2026-10-19')?.totalUsd).toBe(300_00)

    expect((await ack()).statusCode).toBe(200)

    // after it the day shows the poker result only (300.00 − 297.00 ack), with
    // the accepted residual broken out separately
    const room_ = sessionDay('2026-10-19')?.rooms[0]
    expect(room_).toMatchObject({ profitUsd: 300_00, casinoUsd: 0, acknowledgedUsd: 297_00, pokerProfitUsd: 3_00 })
    expect(sessionDay('2026-10-19')?.totalUsd).toBe(3_00)
    // the balance-derived input used by reconciliation is untouched
    expect(room_?.profitUsd).toBe(300_00)

    // a later balance edit invalidates the acknowledgement and the phantom returns
    upsertBalance(room, '2026-10-19', 310_00, 'USD')
    expect(sessionDay('2026-10-19')?.rooms[0]).toMatchObject({ acknowledgedUsd: 0, pokerProfitUsd: 310_00 })
  })
})
