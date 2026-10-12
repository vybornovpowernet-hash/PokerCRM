import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDb, initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import { createRoom, updateRoom } from '../src/services/rooms.js'
import { upsertBalance } from '../src/services/balances.js'
import { createTransaction } from '../src/services/funds.js'
import { deleteImportedTournament, replaceDayTournaments, saveDayBatch } from '../src/services/tournaments.js'
import { listPendingImports, pendingImportPairs, reconcilePendingImports } from '../src/services/pending.js'

let room: number

beforeEach(() => {
  setDbForTests(initDb(':memory:'))
  room = createRoom({ name: 'PokerDom', cashCurrency: 'USD', tournamentCurrency: 'RUB' }).id
})

afterEach(() => resetDbForTests())

describe('pending import lifecycle', () => {
  it('a manual balance without tournaments creates a pending marker for that day', () => {
    upsertBalance(room, '2026-09-10', 100_00, 'USD')
    expect(pendingImportPairs().has(`${room}:2026-09-10`)).toBe(true)
    expect(listPendingImports()).toEqual([{ roomId: room, roomName: 'PokerDom', date: '2026-09-10' }])
  })

  it('an older pending dies when the balance is written to a newer day', () => {
    upsertBalance(room, '2026-09-10', 100_00, 'USD')
    upsertBalance(room, '2026-09-11', 120_00, 'USD')
    expect(pendingImportPairs().has(`${room}:2026-09-10`)).toBe(false)
    expect(pendingImportPairs().has(`${room}:2026-09-11`)).toBe(true)
    expect(pendingImportPairs().size).toBe(1)
  })

  it('re-writes an older day without multiplying markers (latest wins)', () => {
    upsertBalance(room, '2026-09-10', 100_00, 'USD')
    upsertBalance(room, '2026-09-11', 120_00, 'USD')
    upsertBalance(room, '2026-09-10', 110_00, 'USD')
    expect(pendingImportPairs().size).toBe(1)
    expect(pendingImportPairs().has(`${room}:2026-09-11`)).toBe(true)
  })

  it('no manual balance means no pending (auto rows never get one)', () => {
    createTransaction({ roomId: room, type: 'deposit', amount: 50_00, currency: 'USD', direction: 'in', date: '2026-09-10' })
    expect(pendingImportPairs().size).toBe(0)
  })

  it('saving tournaments on the pending day clears the marker', () => {
    upsertBalance(room, '2026-09-10', 100_00, 'USD')
    expect(pendingImportPairs().has(`${room}:2026-09-10`)).toBe(true)
    saveDayBatch(room, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'USD' }])
    expect(pendingImportPairs().size).toBe(0)
  })

  it('an explicit save clears the marker even when it only covered older days', () => {
    upsertBalance(room, '2026-09-10', 100_00, 'USD')
    upsertBalance(room, '2026-09-11', 120_00, 'USD')
    expect(pendingImportPairs().has(`${room}:2026-09-11`)).toBe(true)
    saveDayBatch(room, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'USD' }])
    expect(pendingImportPairs().size).toBe(0)
  })

  it('an empty save keeps the pending marker untouched', () => {
    upsertBalance(room, '2026-09-11', 120_00, 'USD')
    expect(pendingImportPairs().has(`${room}:2026-09-11`)).toBe(true)
    saveDayBatch(room, '2026-09-10', [])
    expect(pendingImportPairs().has(`${room}:2026-09-11`)).toBe(true)
  })

  it('recording a newer balance re-arms the marker after a save cleared it', () => {
    upsertBalance(room, '2026-09-10', 100_00, 'USD')
    upsertBalance(room, '2026-09-11', 120_00, 'USD')
    saveDayBatch(room, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'USD' }])
    expect(pendingImportPairs().size).toBe(0)

    upsertBalance(room, '2026-09-11', 130_00, 'USD')
    expect(pendingImportPairs().has(`${room}:2026-09-11`)).toBe(true)
  })

  it('replacing manual tournament rows clears the marker', () => {
    upsertBalance(room, '2026-09-10', 100_00, 'USD')
    replaceDayTournaments(room, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'USD' }])
    expect(pendingImportPairs().size).toBe(0)
  })

  it('deleting the only imported tournament restores the marker', () => {
    upsertBalance(room, '2026-09-10', 100_00, 'USD')
    saveDayBatch(room, '2026-09-10', [], [
      { tournamentId: 313, name: 'Daily Turbo 5.50', date: '2026-09-10', buyin: 50_00, result: 80_00, rank: 112, entrants: 431, currency: 'USD' }
    ])
    expect(pendingImportPairs().size).toBe(0)
    deleteImportedTournament(room, 313)
    expect(pendingImportPairs().has(`${room}:2026-09-10`)).toBe(true)
  })

  it('an MBR-only import clears the marker like any other played day', () => {
    upsertBalance(room, '2026-09-10', 100_00, 'USD')
    expect(pendingImportPairs().has(`${room}:2026-09-10`)).toBe(true)

    // a quick hyper-turbo Mystery Battle Royale session still counts as play
    saveDayBatch(room, '2026-09-10', [], [
      { tournamentId: 501, name: "Mystery Battle Royale $1, Hold'em No Limit", date: '2026-09-10', buyin: 1_00, result: 0, rank: null, entrants: 18, currency: 'USD' }
    ])
    expect(pendingImportPairs().size).toBe(0)
  })

  it('a wallet room never gets a pending marker', () => {
    const wallet = createRoom({ name: 'Bybit', cashCurrency: 'USD', tournamentCurrency: 'USD', isWallet: true }).id
    upsertBalance(wallet, '2026-09-10', 100_00, 'USD')
    expect(pendingImportPairs().size).toBe(0)
  })

  it('drops an existing marker once a room is flagged as a wallet', () => {
    upsertBalance(room, '2026-09-10', 100_00, 'USD')
    expect(pendingImportPairs().size).toBe(1)

    updateRoom(room, { isWallet: true })

    expect(pendingImportPairs().size).toBe(0)
    upsertBalance(room, '2026-09-11', 150_00, 'USD')
    expect(pendingImportPairs().size).toBe(0)
  })

  it('a wallet row inserted by hand is removed by an explicit reconcile', () => {
    const wallet = createRoom({ name: 'Bybit', cashCurrency: 'USD', tournamentCurrency: 'USD', isWallet: true }).id
    getDb().prepare('INSERT INTO pending_imports (room_id, date) VALUES (?, ?)').run(wallet, '2026-09-10')
    expect(pendingImportPairs().size).toBe(1)

    reconcilePendingImports(wallet)

    expect(pendingImportPairs().size).toBe(0)
  })

  it('the marker is pure bookkeeping and never touches money data', () => {
    upsertBalance(room, '2026-09-10', 100_00, 'USD')
    expect(pendingImportPairs().has(`${room}:2026-09-10`)).toBe(true)

    const balanceRows = getDb().prepare('SELECT COUNT(*) AS c FROM balance_entries WHERE room_id = ?').get(room) as { c: number }
    expect(balanceRows.c).toBe(1)
    const source = getDb().prepare('SELECT source FROM balance_entries WHERE room_id = ?').get(room) as { source: string }
    expect(source.source).toBe('manual')
    const tournamentRows = getDb().prepare('SELECT COUNT(*) AS c FROM tournaments WHERE room_id = ?').get(room) as { c: number }
    expect(tournamentRows.c).toBe(0)
    const txnRows = getDb().prepare('SELECT COUNT(*) AS c FROM transactions WHERE room_id = ?').get(room) as { c: number }
    expect(txnRows.c).toBe(0)
    const pendingRows = getDb().prepare('SELECT COUNT(*) AS c FROM pending_imports').get() as { c: number }
    expect(pendingRows.c).toBe(1)
  })
})