import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import { createRoom, deleteRoom } from '../src/services/rooms.js'
import { getBalance } from '../src/services/balances.js'
import { upsertRate } from '../src/services/rates/storage.js'
import {
  createTransaction,
  deleteTransaction,
  flowTotals,
  getTransaction,
  listTransactions,
  updateTransaction
} from '../src/services/funds.js'
import type { TransactionInput } from '../src/services/funds.js'

let roomId: number
let destRoomId: number

function tx(overrides: Partial<TransactionInput> = {}): TransactionInput {
  return {
    roomId,
    type: 'deposit',
    amount: 100_00,
    fee: 0,
    currency: 'USD',
    direction: 'in',
    date: '2026-09-09',
    ...overrides
  }
}

describe('transactions', () => {
  beforeEach(() => {
    setDbForTests(initDb(':memory:'))
    roomId = createRoom({ name: 'PokerDom', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    destRoomId = createRoom({ name: 'RedStar', cashCurrency: 'RUB', tournamentCurrency: 'USD' }).id
  })
  afterEach(() => resetDbForTests())

  it('creates a deposit and returns it with the room name', () => {
    const t = createTransaction(tx())
    expect(t.roomName).toBe('PokerDom')
    expect(t.direction).toBe('in')
    expect(t.type).toBe('deposit')
    expect(t.destinationRoomId).toBeNull()
  })

  it('rejects a deposit with direction out and a withdraw with direction in', () => {
    expect(() => createTransaction(tx({ type: 'deposit', direction: 'out' }))).toThrow(/deposit/)
    expect(() => createTransaction(tx({ type: 'withdraw', direction: 'in', amount: 50_00 }))).toThrow(/withdraw/)
  })

  it('validates amount, fee, currency and date', () => {
    expect(() => createTransaction(tx({ amount: 0 }))).toThrow(/amount/)
    expect(() => createTransaction(tx({ fee: -1 }))).toThrow(/fee/)
    expect(() => createTransaction(tx({ currency: 'RUBBISH' }))).toThrow(/currency/)
    expect(() => createTransaction(tx({ date: '09-09-2026' }))).toThrow(/date/)
    expect(() => createTransaction(tx({ roomId: 999 }))).toThrow(/Room not found/)
  })

  it('creates a signed casino result and derives direction from the sign', () => {
    const win = createTransaction(tx({ type: 'casino', amount: 20_00, direction: 'out' }))
    expect(win.amount).toBe(20_00)
    expect(win.direction).toBe('in')

    const loss = createTransaction(tx({ type: 'casino', amount: -20_00, direction: 'in', date: '2026-09-10' }))
    expect(loss.amount).toBe(-20_00)
    expect(loss.direction).toBe('out')
  })

  it('requires a non-zero integer, no fee and no destination for casino', () => {
    expect(() => createTransaction(tx({ type: 'casino', amount: 0 }))).toThrow(/amount/)
    expect(() => createTransaction(tx({ type: 'casino', amount: 10_00, fee: 50 }))).toThrow(/fee/)
    expect(() => createTransaction(tx({ type: 'casino', amount: 10_00, destinationRoomId: destRoomId }))).toThrow(
      /only allowed for transfers/
    )
  })

  it('excludes casino from external fund flows', () => {
    createTransaction(tx({ type: 'deposit', amount: 100_00, date: '2026-09-09' }))
    createTransaction(tx({ type: 'casino', amount: 30_00, date: '2026-09-09' }))
    createTransaction(tx({ type: 'casino', amount: -10_00, date: '2026-09-09' }))

    const flows = flowTotals('2026-09-09', '2026-09-09')
    expect(flows.find((f) => f.roomId === roomId && f.direction === 'in')?.total).toBe(100_00)
    expect(flows.find((f) => f.roomId === roomId && f.direction === 'out')).toBeUndefined()
  })

  it('requires a destination room for transfers and rejects destination hacks', () => {
    expect(() => createTransaction(tx({ type: 'transfer' }))).toThrow(/destinationRoomId/)
    expect(() => createTransaction(tx({ type: 'transfer', destinationRoomId: roomId }))).toThrow(/same as the source/)
    expect(() => createTransaction(tx({ type: 'deposit', destinationRoomId: destRoomId }))).toThrow(/only allowed for transfers/)
    expect(() => createTransaction(tx({ type: 'transfer', destinationRoomId: 999 }))).toThrow(/Room not found/)
  })

  it('forces transfer direction to out regardless of the client hint', () => {
    const t = createTransaction(tx({ type: 'transfer', direction: 'in', destinationRoomId: destRoomId }))
    expect(t.direction).toBe('out')
    expect(t.destinationRoomId).toBe(destRoomId)
    expect(t.destinationRoomName).toBe('RedStar')
  })

  it('keeps the sender ledger row (and its outflow) when the destination room is deleted', () => {
    const t = createTransaction(tx({ type: 'transfer', amount: 20_00, fee: 1_00, destinationRoomId: destRoomId, date: '2026-09-09' }))
    deleteRoom(destRoomId)

    // the row survives in the sender's history, it only loses its recipient
    const kept = getTransaction(t.id)
    expect(kept.type).toBe('transfer')
    expect(kept.amount).toBe(20_00)
    expect(kept.fee).toBe(1_00)
    expect(kept.destinationRoomId).toBeNull()
    expect(kept.destinationRoomName).toBeNull()

    // the money left the sender: −(20 + 1) still stands on the balance chain
    expect(getBalance(roomId, '2026-09-09')?.amount).toBe(-21_00)
  })

  it('lists, filters and updates', () => {
    createTransaction(tx({ type: 'deposit', date: '2026-09-09' }))
    createTransaction(tx({ type: 'withdraw', direction: 'out', amount: 5_00, date: '2026-09-10' }))
    createTransaction(tx({ type: 'transfer', amount: 20_00, destinationRoomId: destRoomId, date: '2026-09-11' }))

    expect(listTransactions({ type: 'deposit' })).toHaveLength(1)
    expect(listTransactions({ type: 'transfer' })).toHaveLength(1)
    expect(listTransactions({ dateFrom: '2026-09-10', dateTo: '2026-09-11' })).toHaveLength(2)

    const updated = updateTransaction(1, tx({ type: 'deposit', amount: 300_00, comment: 'big deposit' }))
    expect(updated.amount).toBe(300_00)
    expect(updated.comment).toBe('big deposit')
    expect(updated.destinationRoomId).toBeNull()
  })

  it('computes flow totals with fee on outgoing and amount on incoming', () => {
    createTransaction(tx({ type: 'deposit', amount: 100_00, date: '2026-09-09' }))
    createTransaction(tx({ type: 'withdraw', direction: 'out', amount: 10_00, fee: 50, date: '2026-09-09' }))
    createTransaction(tx({ type: 'transfer', amount: 25_00, fee: 1_00, destinationRoomId: destRoomId, date: '2026-09-09' }))

    const flows = flowTotals('2026-09-09', '2026-09-09')
    const senderIn = flows.find((f) => f.roomId === roomId && f.direction === 'in')
    const senderOut = flows.find((f) => f.roomId === roomId && f.direction === 'out')
    expect(senderIn?.total).toBe(100_00)
    expect(senderOut?.total).toBe(36_50) // 10 withdraw + 0.50 fee + 25 transfer + 1.00 fee
  })

  it('converts the transfer receiving leg into the destination currency', () => {
    upsertRate('2026-09-09', 'USD', 'RUB', Math.round(88 * 10_000), 'pokerdom')
    createTransaction(tx({ type: 'transfer', amount: 10_00, fee: 0, currency: 'USD', destinationRoomId: destRoomId, date: '2026-09-09' }))
    createTransaction(tx({ type: 'deposit', amount: 5_00, date: '2026-09-09' }))

    const flows = flowTotals('2026-09-09', '2026-09-09')
    const rubLeg = flows.find((f) => f.roomId === destRoomId && f.direction === 'in')
    expect(rubLeg?.currency).toBe('RUB')
    expect(rubLeg?.total).toBe(880_00) // 10.00 USD → 880.00 RUB at 88

    const senderOut = flows.find((f) => f.roomId === roomId && f.direction === 'out')
    expect(senderOut?.total).toBe(10_00)
  })

  it('creates a transfer with a fee charged on the sender side', () => {
    const t = createTransaction(tx({ type: 'transfer', amount: 50_00, fee: 2_50, destinationRoomId: destRoomId }))
    expect(t.fee).toBe(2_50)
    expect(t.direction).toBe('out')
  })

  it('deletes a transaction', () => {
    const t = createTransaction(tx())
    deleteTransaction(t.id)
    expect(() => getTransaction(t.id)).toThrow(/Transaction not found/)
    expect(listTransactions()).toHaveLength(0)
  })

  it('returns amountUsd converted with the transaction date rate, ignoring fee', () => {
    upsertRate('2026-09-09', 'USD', 'RUB', Math.round(90 * 10_000), 'pokerdom')
    upsertRate('2026-09-09', 'EUR', 'USD', Math.round(1.1 * 10_000), 'er-api')

    const usd = createTransaction(tx({ type: 'deposit', amount: 100_00, currency: 'USD', date: '2026-09-09' }))
    expect(usd.amountUsd).toBe(100_00)

    const eur = createTransaction(
      tx({ type: 'withdraw', direction: 'out', amount: 100_00, fee: 2_50, currency: 'EUR', date: '2026-09-09' })
    )
    expect(eur.amountUsd).toBe(110_00) // fee does not leak into amountUsd

    const rub = createTransaction(tx({ type: 'deposit', amount: 90_00, currency: 'RUB', date: '2026-09-09' }))
    expect(rub.amountUsd).toBe(100) // 90.00 RUB at 90 RUB/USD = $1.00

    // 09-10 has no frozen rate, but the latest known (09-09) is used as a fallback
    const fallback = createTransaction(tx({ type: 'withdraw', direction: 'out', amount: 90_00, currency: 'RUB', date: '2026-09-10' }))
    expect(fallback.amountUsd).toBe(100)
  })

  it('returns null amountUsd when no rate has ever been stored', () => {
    const t = createTransaction(tx({ type: 'deposit', amount: 100_00, currency: 'RUB', date: '2026-09-09' }))
    expect(t.amountUsd).toBeNull()
  })
})