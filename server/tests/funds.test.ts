import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import { createRoom, deleteRoom } from '../src/services/rooms.js'
import { getBalance, roomFlowsUsd, upsertBalance } from '../src/services/balances.js'
import { upsertRate } from '../src/services/rates/storage.js'
import { convertToUsd } from '../src/services/rates/convert.js'
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

  it('stores and returns the exact destAmount in the destination room currency', () => {
    const t = createTransaction(
      tx({ type: 'transfer', amount: 50_00, fee: 1_30, currency: 'USD', destinationRoomId: destRoomId, destAmount: 4247_59, date: '2026-09-09' })
    )
    expect(t.destAmount).toBe(4247_59)
    expect(t.destCurrency).toBe('RUB')
    const fetched = getTransaction(t.id)
    expect(fetched.destAmount).toBe(4247_59)
    expect(fetched.destCurrency).toBe('RUB')
    expect(listTransactions({ type: 'transfer' })[0].destAmount).toBe(4247_59)
  })

  it('rejects destAmount outside transfers and non-positive values', () => {
    expect(() => createTransaction(tx({ type: 'deposit', destAmount: 100 }))).toThrow(/destAmount: only allowed for transfers/)
    expect(() => createTransaction(tx({ type: 'casino', amount: 10_00, destAmount: 100 }))).toThrow(/destAmount/)
    expect(() => createTransaction(tx({ type: 'transfer', destinationRoomId: destRoomId, destAmount: 0 }))).toThrow(
      /destAmount: must be a positive integer/
    )
    expect(() => createTransaction(tx({ type: 'transfer', destinationRoomId: destRoomId, destAmount: 10.5 }))).toThrow(
      /destAmount: must be a positive integer/
    )
  })

  it('credits the receiving flow leg with the exact dest_amount, not the feed rate', () => {
    upsertRate('2026-09-09', 'USD', 'RUB', Math.round(87.02 * 10_000), 'pokerdom')
    createTransaction(
      tx({ type: 'transfer', amount: 50_00, fee: 1_30, currency: 'USD', destinationRoomId: destRoomId, destAmount: 4247_59, date: '2026-09-09' })
    )

    const flows = flowTotals('2026-09-09', '2026-09-09')
    const rubLeg = flows.find((f) => f.roomId === destRoomId && f.direction === 'in')
    expect(rubLeg?.currency).toBe('RUB')
    expect(rubLeg?.total).toBe(4247_59) // the room's cash-desk figure, not 50.00 × 87.02

    const senderOut = flows.find((f) => f.roomId === roomId && f.direction === 'out')
    expect(senderOut?.currency).toBe('USD')
    expect(senderOut?.total).toBe(51_30) // amount + network fee stay on the sender's side
  })

  it('shifts the destination manual balance by the exact dest_amount without conversion drift', () => {
    upsertRate('2026-09-09', 'USD', 'RUB', Math.round(87.02 * 10_000), 'pokerdom')
    upsertBalance(destRoomId, '2026-09-09', 1000_00, 'RUB')
    createTransaction(
      tx({ type: 'transfer', amount: 50_00, fee: 0, currency: 'USD', destinationRoomId: destRoomId, destAmount: 4247_59, date: '2026-09-09' })
    )

    expect(getBalance(destRoomId, '2026-09-09')?.amount).toBe(1000_00 + 4247_59)
  })

  it('reverses and reapplies the exact dest leg on update and delete', () => {
    upsertRate('2026-09-09', 'USD', 'RUB', Math.round(87.02 * 10_000), 'pokerdom')
    upsertBalance(destRoomId, '2026-09-09', 1000_00, 'RUB')
    const t = createTransaction(
      tx({ type: 'transfer', amount: 50_00, fee: 0, currency: 'USD', destinationRoomId: destRoomId, destAmount: 4247_59, date: '2026-09-09' })
    )
    expect(getBalance(destRoomId, '2026-09-09')?.amount).toBe(5247_59)

    const updated = updateTransaction(t.id, tx({ type: 'transfer', amount: 50_00, fee: 0, currency: 'USD', destinationRoomId: destRoomId, destAmount: 4351_00, date: '2026-09-09' }))
    expect(updated.destAmount).toBe(4351_00)
    expect(getBalance(destRoomId, '2026-09-09')?.amount).toBe(1000_00 + 4351_00)

    deleteTransaction(t.id)
    expect(getBalance(destRoomId, '2026-09-09')?.amount).toBe(1000_00)
  })

  it('keeps the receiving room profit-neutral when the room rate differs from the feed rate', () => {
    upsertRate('2026-09-09', 'USD', 'RUB', Math.round(87.02 * 10_000), 'pokerdom')
    upsertRate('2026-09-10', 'USD', 'RUB', Math.round(87.02 * 10_000), 'pokerdom')
    // yesterday's manual anchor in RUB; today the room credited 4247.59 RUB at ITS
    // internal 87.10 while the feed says 87.02 — profit must still be zero
    upsertBalance(destRoomId, '2026-09-09', 1000_00, 'RUB')
    createTransaction(
      tx({ type: 'transfer', amount: 50_00, fee: 0, currency: 'USD', destinationRoomId: destRoomId, destAmount: 4247_59, date: '2026-09-10' })
    )

    const credited = getBalance(destRoomId, '2026-09-10')
    expect(credited?.source).toBe('auto')
    expect(credited?.amount).toBe(1000_00 + 4247_59)

    const deltaUsd = convertToUsd(4247_59, 'RUB', '2026-09-10', destRoomId)
    expect(deltaUsd).not.toBeNull()
    // profit = delta − (in − out): the flow leg converts the SAME credited RUB amount,
    // so the spread between the room rate and the feed rate never leaks into profit
    expect(roomFlowsUsd(destRoomId, '2026-09-10').inUsd).toBe(deltaUsd)
  })

  it('rejects an exact destAmount on a same-currency transfer', () => {
    const sameCurrencyRoomId = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    expect(() =>
      createTransaction(tx({ type: 'transfer', amount: 50_00, fee: 0, currency: 'USD', destinationRoomId: sameCurrencyRoomId, destAmount: 50_00 }))
    ).toThrow(/destAmount/)
    // the plain same-currency transfer without the exact figure stays valid
    expect(() => createTransaction(tx({ type: 'transfer', amount: 50_00, fee: 0, currency: 'USD', destinationRoomId: sameCurrencyRoomId }))).not.toThrow()
  })

  it('rejects an exact destAmount when an update moves the transfer to a same-currency room', () => {
    const sameCurrencyRoomId = createRoom({ name: 'GG', cashCurrency: 'USD', tournamentCurrency: 'USD' }).id
    const t = createTransaction(
      tx({ type: 'transfer', amount: 50_00, fee: 0, currency: 'USD', destinationRoomId: destRoomId, destAmount: 4247_59, date: '2026-09-09' })
    )
    expect(() =>
      updateTransaction(t.id, tx({ type: 'transfer', amount: 50_00, fee: 0, currency: 'USD', destinationRoomId: sameCurrencyRoomId, destAmount: 4247_59, date: '2026-09-09' }))
    ).toThrow(/destAmount/)
    // the rejected update must not have rewritten the row or its legs
    expect(getTransaction(t.id).destinationRoomId).toBe(destRoomId)
    expect(getTransaction(t.id).destAmount).toBe(4247_59)
  })

  it('accepts an exact destAmount when the destination room has another cash currency', () => {
    const t = createTransaction(
      tx({ type: 'transfer', amount: 50_00, fee: 1_30, currency: 'USD', destinationRoomId: destRoomId, destAmount: 4247_59, date: '2026-09-09' })
    )
    expect(t.destAmount).toBe(4247_59)
    expect(t.destCurrency).toBe('RUB')
  })

  it('clears dest_amount when an update moves the receiver and sends no exact figure', () => {
    const eurRoomId = createRoom({ name: 'PokerStars', cashCurrency: 'EUR', tournamentCurrency: 'EUR' }).id
    const t = createTransaction(
      tx({ type: 'transfer', amount: 50_00, fee: 0, currency: 'USD', destinationRoomId: destRoomId, destAmount: 4247_59, date: '2026-09-09' })
    )
    const moved = updateTransaction(t.id, tx({ type: 'transfer', amount: 50_00, fee: 0, currency: 'USD', destinationRoomId: eurRoomId, destAmount: null, date: '2026-09-09' }))
    expect(moved.destinationRoomId).toBe(eurRoomId)
    expect(moved.destAmount).toBeNull()
    expect(getTransaction(t.id).destAmount).toBeNull()
  })
})