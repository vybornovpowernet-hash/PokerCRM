import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initDb, resetDbForTests, setDbForTests } from '../src/db.js'
import { createRoom } from '../src/services/rooms.js'
import { createTransaction, updateTransaction, deleteTransaction } from '../src/services/funds.js'
import {
  upsertBalance,
  getLatestBalances,
  listForDate,
  totalCurrentUsd,
  getBalance,
  getBalanceBefore,
  recomputeRoomBalances
} from '../src/services/balances.js'
import { sessionsInRange } from '../src/services/sessions.js'
import { replaceDayTournaments } from '../src/services/tournaments.js'
import { upsertRate } from '../src/services/rates/storage.js'

let pokerdon: number
let redstar: number

function rateUsdRub(date: string, rubPerUsd: number) {
  upsertRate(date, 'USD', 'RUB', Math.round(rubPerUsd * 10_000), 'pokerdom')
}
function rateEurUsd(date: string, usdPerEur: number) {
  upsertRate(date, 'EUR', 'USD', Math.round(usdPerEur * 10_000), 'er-api')
}

beforeEach(() => {
  setDbForTests(initDb(':memory:'))
  pokerdon = createRoom({ name: 'PokerDom', cashCurrency: 'USD', tournamentCurrency: 'RUB' }).id
  redstar = createRoom({ name: 'RedStar', cashCurrency: 'EUR', tournamentCurrency: 'EUR' }).id
  rateUsdRub('2026-09-09', 90)
  rateUsdRub('2026-09-10', 90)
  rateEurUsd('2026-09-09', 1.1)
  rateEurUsd('2026-09-10', 1.1)
})

afterEach(() => resetDbForTests())

describe('balances', () => {
  it('upserts per room+day and resolves latest/before', () => {
    upsertBalance(pokerdon, '2026-09-09', 100_00, 'USD')
    upsertBalance(pokerdon, '2026-09-10', 140_00, 'USD')
    upsertBalance(pokerdon, '2026-09-10', 150_00, 'USD') // overwrite same day

    expect(listForDate('2026-09-10')).toHaveLength(1)
    expect(getBalance(pokerdon, '2026-09-09')?.amount).toBe(100_00)
    expect(getBalanceBefore(pokerdon, '2026-09-10')?.amount).toBe(100_00)
    expect(getLatestBalances().find((b) => b.roomId === pokerdon)?.amount).toBe(150_00)
    expect(totalCurrentUsd()).toBe(150_00)
  })

  it('rejects invalid inputs', () => {
    expect(() => upsertBalance(pokerdon, '2026-09-10', -1, 'USD')).toThrow(/amount/)
    expect(() => upsertBalance(pokerdon, 'x', 100, 'USD')).toThrow(/date/)
    expect(() => upsertBalance(999, '2026-09-10', 100, 'USD')).toThrow(/Room not found/)
  })
})

describe('sessions profit (everything in USD)', () => {
  it('computes room and total profit excluding deposits/withdrawals', () => {
    // balances are recorded AFTER the day's operations, so the snapshots
    // already include the flows and the flows must stay profit-neutral
    createTransaction({ roomId: pokerdon, type: 'deposit', amount: 50_00, currency: 'USD', direction: 'in', date: '2026-09-10' })
    createTransaction({ roomId: redstar, type: 'withdraw', amount: 10_00, fee: 2_50, currency: 'EUR', direction: 'out', date: '2026-09-10' })
    upsertBalance(pokerdon, '2026-09-09', 100_00, 'USD')
    upsertBalance(pokerdon, '2026-09-10', 140_00, 'USD')
    upsertBalance(redstar, '2026-09-09', 2_000_00, 'EUR')
    upsertBalance(redstar, '2026-09-10', 2_200_00, 'EUR')

    const days = sessionsInRange('2026-09-10', '2026-09-10')
    expect(days).toHaveLength(1)
    const rooms = days[0].rooms
    const pd = rooms.find((r) => r.roomId === pokerdon)
    const rs = rooms.find((r) => r.roomId === redstar)

    // PokerDom: delta +$40, deposit +$50 in → profit = 40 − 50 = −$10 USD
    expect(pd?.profitUsd).toBe(-10_00)
    // RedStar: delta +€200 = +$220, withdraw €12.50 (incl. fee) = $13.75 out → profit = 220 − (0 − 13.75) = $233.75
    expect(rs?.profitUsd).toBe(233_75)
    expect(days[0].totalUsd).toBe(233_75 - 10_00)
  })

  it('treats the first recorded day as delta from zero', () => {
    createTransaction({ roomId: pokerdon, type: 'deposit', amount: 50_00, currency: 'USD', direction: 'in', date: '2026-09-10' })
    upsertBalance(pokerdon, '2026-09-10', 100_00, 'USD')
    const days = sessionsInRange('2026-09-10', '2026-09-10')
    expect(days[0].rooms[0].profitUsd).toBe(100_00 - 50_00)
  })

  it('rates frozen per day: old days keep old conversion', () => {
    // EUR/USD for the earlier day = 1.0, later = 1.1
    rateEurUsd('2026-09-09', 1.0)
    upsertBalance(redstar, '2026-09-09', 2_000_00, 'EUR')
    upsertBalance(redstar, '2026-09-10', 2_200_00, 'EUR')
    const days = sessionsInRange('2026-09-10', '2026-09-10')
    // delta 200 EUR converted with the 09-10 rate (1.1) = 220 USD, no flows
    expect(days[0].rooms[0].profitUsd).toBe(220_00)
  })
})

describe('current balances (manual and auto)', () => {
  it('returns the latest balance per room regardless of source and sums them', () => {
    createTransaction({ roomId: pokerdon, type: 'deposit', amount: 50_00, currency: 'USD', direction: 'in', date: '2026-09-09' })
    upsertBalance(redstar, '2026-09-09', 2_000_00, 'EUR')

    const latest = getLatestBalances()
    const pd = latest.find((b) => b.roomId === pokerdon)
    expect(pd?.amount).toBe(50_00)
    expect(pd?.source).toBe('auto')
    const rs = latest.find((b) => b.roomId === redstar)
    expect(rs?.amount).toBe(2_000_00)
    expect(rs?.source).toBe('manual')
    // $50 + €2000 → $50 + $2200
    expect(totalCurrentUsd()).toBe(50_00 + 2_200_00)
  })

  it('manual upsert flips an auto row to manual so it is no longer re-derived', () => {
    createTransaction({ roomId: pokerdon, type: 'deposit', amount: 50_00, currency: 'USD', direction: 'in', date: '2026-09-09' })
    upsertBalance(pokerdon, '2026-09-09', 140_00, 'USD')
    expect(getBalance(pokerdon, '2026-09-09')?.source).toBe('manual')
    expect(getBalance(pokerdon, '2026-09-09')?.amount).toBe(140_00)
  })
})

describe('auto-adjust balance on transactions', () => {
  it('creates an auto balance entry on the transaction date from a zero base', () => {
    createTransaction({ roomId: pokerdon, type: 'deposit', amount: 50_00, currency: 'USD', direction: 'in', date: '2026-09-09' })
    expect(getBalance(pokerdon, '2026-09-09')?.amount).toBe(50_00)
    expect(getBalance(pokerdon, '2026-09-09')?.currency).toBe('USD')
  })

  it('nets deposit and withdraw on the same day', () => {
    createTransaction({ roomId: pokerdon, type: 'deposit', amount: 100_00, currency: 'USD', direction: 'in', date: '2026-09-09' })
    createTransaction({ roomId: pokerdon, type: 'withdraw', amount: 30_00, currency: 'USD', direction: 'out', date: '2026-09-09' })
    expect(getBalance(pokerdon, '2026-09-09')?.amount).toBe(70_00)
  })

  it('keeps carry between manual anchors, absorbing flows into manual days', () => {
    upsertBalance(redstar, '2026-09-09', 2_000_00, 'EUR')
    createTransaction({ roomId: redstar, type: 'deposit', amount: 100_00, currency: 'EUR', direction: 'in', date: '2026-09-10' })
    expect(getBalance(redstar, '2026-09-09')?.amount).toBe(2_000_00)
    expect(getBalance(redstar, '2026-09-10')?.amount).toBe(2_100_00)
  })

  it('manual upsert overrides an auto entry; a later same-day edit shifts the snapshot', () => {
    createTransaction({ roomId: pokerdon, type: 'deposit', amount: 100_00, currency: 'USD', direction: 'in', date: '2026-09-09' })
    upsertBalance(pokerdon, '2026-09-09', 140_00, 'USD')
    expect(getBalance(pokerdon, '2026-09-09')?.amount).toBe(140_00)

    updateTransaction(1, { roomId: pokerdon, type: 'deposit', amount: 80_00, currency: 'USD', direction: 'in', date: '2026-09-09' })
    // reverse the +$100 shift, apply +$80: 140 − 100 + 80
    expect(getBalance(pokerdon, '2026-09-09')?.amount).toBe(120_00)
  })

  it('re-derives the chain when an edit changes the transaction date', () => {
    createTransaction({ roomId: pokerdon, type: 'deposit', amount: 100_00, currency: 'USD', direction: 'in', date: '2026-09-09' })
    updateTransaction(1, { roomId: pokerdon, type: 'deposit', amount: 100_00, currency: 'USD', direction: 'in', date: '2026-09-10' })
    expect(getBalance(pokerdon, '2026-09-09')).toBeNull()
    expect(getBalance(pokerdon, '2026-09-10')?.amount).toBe(100_00)
  })

  it('re-derives both rooms when an edit moves a transaction to another room', () => {
    const tx = createTransaction({ roomId: pokerdon, type: 'deposit', amount: 100_00, currency: 'USD', direction: 'in', date: '2026-09-09' })
    createTransaction({ roomId: redstar, type: 'deposit', amount: 50_00, currency: 'EUR', direction: 'in', date: '2026-09-09' })
    updateTransaction(tx.id, { roomId: redstar, type: 'deposit', amount: 100_00, currency: 'USD', direction: 'in', date: '2026-09-09' })
    expect(getBalance(pokerdon, '2026-09-09')).toBeNull()
    // RedStar chain is in EUR: €50 + $100→€ at 1.1 (≈€90.91)
    expect(getBalance(redstar, '2026-09-09')?.amount).toBe(50_00 + 90_91)
  })

  it('removes auto entries after a transaction is deleted', () => {
    const tx = createTransaction({ roomId: pokerdon, type: 'deposit', amount: 100_00, currency: 'USD', direction: 'in', date: '2026-09-09' })
    deleteTransaction(tx.id)
    expect(getBalance(pokerdon, '2026-09-09')).toBeNull()
  })

  it('excludes auto-only transaction days from sessions (bookkeeping is not play)', () => {
    createTransaction({ roomId: pokerdon, type: 'deposit', amount: 100_00, currency: 'USD', direction: 'in', date: '2026-09-10' })
    const days = sessionsInRange('2026-09-10', '2026-09-10')
    expect(days).toHaveLength(0)
  })

  it('keeps an auto-only day when tournaments were played in the room', () => {
    createTransaction({ roomId: pokerdon, type: 'deposit', amount: 100_00, currency: 'USD', direction: 'in', date: '2026-09-10' })
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 50_00, result: 80_00, currency: 'USD' }])
    const days = sessionsInRange('2026-09-10', '2026-09-10')
    expect(days).toHaveLength(1)
    expect(days[0].rooms).toHaveLength(1)
    expect(days[0].rooms[0].roomId).toBe(pokerdon)
  })

  it('drops other rooms from a day when only one room had manual balance or tournaments', () => {
    // RedStar manual yesterday → auto-only deposit today; PokerDom manual today
    upsertBalance(redstar, '2026-09-09', 2_000_00, 'EUR')
    createTransaction({ roomId: redstar, type: 'deposit', amount: 100_00, currency: 'EUR', direction: 'in', date: '2026-09-10' })
    upsertBalance(pokerdon, '2026-09-10', 140_00, 'USD')

    const days = sessionsInRange('2026-09-10', '2026-09-10')
    expect(days).toHaveLength(1)
    expect(days[0].rooms.map((r) => r.roomId)).toEqual([pokerdon])
  })

  it('converts cross-currency transactions into the anchor currency', () => {
    upsertBalance(pokerdon, '2026-09-09', 1_000_00, 'USD')
    createTransaction({ roomId: pokerdon, type: 'deposit', amount: 100_00, currency: 'EUR', direction: 'in', date: '2026-09-10' })
    // €100 at 1.1 = $110 → 1000 + 110
    expect(getBalance(pokerdon, '2026-09-10')?.amount).toBe(1_110_00)
  })
})

describe('auto-adjust a manual balance on a same-day transaction', () => {
  it('shifts the same-day manual balance on a deposit', () => {
    upsertBalance(pokerdon, '2026-09-10', 100_00, 'USD')
    createTransaction({ roomId: pokerdon, type: 'deposit', amount: 50_00, currency: 'USD', direction: 'in', date: '2026-09-10' })
    const entry = getBalance(pokerdon, '2026-09-10')
    expect(entry?.amount).toBe(150_00)
    expect(entry?.source).toBe('manual')
  })

  it('shifts the same-day balance on a casino loss and reports it as session profit', () => {
    upsertBalance(pokerdon, '2026-09-09', 100_00, 'USD')
    upsertBalance(pokerdon, '2026-09-10', 100_00, 'USD')
    createTransaction({ roomId: pokerdon, type: 'casino', amount: -30_00, currency: 'USD', date: '2026-09-10' })
    expect(getBalance(pokerdon, '2026-09-10')?.amount).toBe(70_00)
    expect(sessionsInRange('2026-09-10', '2026-09-10')[0].rooms[0].profitUsd).toBe(-30_00)
  })

  it('adjusts both legs of a same-day transfer', () => {
    upsertBalance(pokerdon, '2026-09-10', 100_00, 'USD')
    upsertBalance(redstar, '2026-09-10', 500_00, 'EUR')
    createTransaction({
      roomId: pokerdon, type: 'transfer', amount: 30_00, fee: 0, currency: 'USD', destinationRoomId: redstar, date: '2026-09-10'
    })
    expect(getBalance(pokerdon, '2026-09-10')?.amount).toBe(70_00)
    // €500 + $30 at 1.1 USD/EUR ≈ €27.27
    expect(getBalance(redstar, '2026-09-10')?.amount).toBe(527_27)
  })

  it('reverts the shift when the transaction is deleted', () => {
    upsertBalance(pokerdon, '2026-09-10', 100_00, 'USD')
    const t = createTransaction({ roomId: pokerdon, type: 'deposit', amount: 50_00, currency: 'USD', direction: 'in', date: '2026-09-10' })
    expect(getBalance(pokerdon, '2026-09-10')?.amount).toBe(150_00)
    deleteTransaction(t.id)
    expect(getBalance(pokerdon, '2026-09-10')?.amount).toBe(100_00)
  })

  it('re-derives the shift when the amount changes', () => {
    upsertBalance(pokerdon, '2026-09-10', 100_00, 'USD')
    const t = createTransaction({ roomId: pokerdon, type: 'deposit', amount: 50_00, currency: 'USD', direction: 'in', date: '2026-09-10' })
    updateTransaction(t.id, { roomId: pokerdon, type: 'deposit', amount: 80_00, currency: 'USD', direction: 'in', date: '2026-09-10' })
    expect(getBalance(pokerdon, '2026-09-10')?.amount).toBe(180_00)
  })

  it('shifts a manual snapshot when a later transaction lands on the same day', () => {
    createTransaction({ roomId: pokerdon, type: 'deposit', amount: 50_00, currency: 'USD', direction: 'in', date: '2026-09-10' })
    upsertBalance(pokerdon, '2026-09-10', 140_00, 'USD')
    expect(getBalance(pokerdon, '2026-09-10')?.amount).toBe(140_00)
    // no base_tx_id guard anymore: the recorded snapshot follows the new operation
    createTransaction({ roomId: pokerdon, type: 'deposit', amount: 10_00, currency: 'USD', direction: 'in', date: '2026-09-10' })
    expect(getBalance(pokerdon, '2026-09-10')?.amount).toBe(150_00)
  })

  it('never shifts manual balances recorded on other days', () => {
    upsertBalance(pokerdon, '2026-09-09', 100_00, 'USD')
    upsertBalance(pokerdon, '2026-09-10', 140_00, 'USD')
    createTransaction({ roomId: pokerdon, type: 'casino', amount: -25_00, currency: 'USD', date: '2026-09-11' })
    // historical snapshots stay intact — this is the regression that v17 broke
    expect(getBalance(pokerdon, '2026-09-09')?.amount).toBe(100_00)
    expect(getBalance(pokerdon, '2026-09-10')?.amount).toBe(140_00)
    // the transaction's own (manual-free) day is still interpolated
    expect(getBalance(pokerdon, '2026-09-11')?.amount).toBe(115_00)
    expect(getBalance(pokerdon, '2026-09-11')?.source).toBe('auto')
  })

  it('is idempotent: a later recompute does not double the same-day shift', () => {
    upsertBalance(pokerdon, '2026-09-10', 100_00, 'USD')
    createTransaction({ roomId: pokerdon, type: 'deposit', amount: 50_00, currency: 'USD', direction: 'in', date: '2026-09-10' })
    // reads/tournament writes rebuild the chain without re-applying the transaction
    recomputeRoomBalances(pokerdon)
    expect(getBalance(pokerdon, '2026-09-10')?.amount).toBe(150_00)
    recomputeRoomBalances(pokerdon)
    expect(getBalance(pokerdon, '2026-09-10')?.amount).toBe(150_00)
  })

  it('keeps the carried chain consistent after a same-day shift', () => {
    upsertBalance(pokerdon, '2026-09-10', 100_00, 'USD')
    createTransaction({ roomId: pokerdon, type: 'deposit', amount: 50_00, currency: 'USD', direction: 'in', date: '2026-09-10' })
    createTransaction({ roomId: pokerdon, type: 'deposit', amount: 10_00, currency: 'USD', direction: 'in', date: '2026-09-11' })
    expect(getBalance(pokerdon, '2026-09-10')?.amount).toBe(150_00)
    // 09-11 has no anchor, so its own flow is interpolated on top of the 09-10 carry
    expect(getBalance(pokerdon, '2026-09-11')?.amount).toBe(160_00)
  })
})

describe('casino transactions', () => {
  it('adds a signed casino result to the room balance', () => {
    upsertBalance(pokerdon, '2026-09-09', 100_00, 'USD')
    createTransaction({ roomId: pokerdon, type: 'casino', amount: 25_00, currency: 'USD', date: '2026-09-10' })
    createTransaction({ roomId: pokerdon, type: 'casino', amount: -10_00, currency: 'USD', date: '2026-09-10' })
    // 100 + 25 − 10 = 115
    expect(getBalance(pokerdon, '2026-09-10')?.amount).toBe(115_00)
  })

  it('counts a casino-only auto day as a session with the casino result as profit', () => {
    upsertBalance(pokerdon, '2026-09-09', 100_00, 'USD')
    createTransaction({ roomId: pokerdon, type: 'casino', amount: -15_00, currency: 'USD', date: '2026-09-10' })
    const days = sessionsInRange('2026-09-10', '2026-09-10')
    expect(days).toHaveLength(1)
    expect(days[0].rooms).toHaveLength(1)
    expect(days[0].rooms[0].profitUsd).toBe(-15_00)
  })

  it('exposes casinoUsd and a pure-poker pokerProfitUsd while profitUsd stays the balance result', () => {
    upsertBalance(pokerdon, '2026-09-09', 100_00, 'USD')
    upsertBalance(pokerdon, '2026-09-10', 100_00, 'USD')
    createTransaction({ roomId: pokerdon, type: 'casino', amount: -30_00, currency: 'USD', date: '2026-09-10' })

    const day = sessionsInRange('2026-09-10', '2026-09-10')[0]
    // balance-based, unchanged — this is the reconcile input (R = S − T − X)
    expect(day.rooms[0].profitUsd).toBe(-30_00)
    expect(day.rooms[0].casinoUsd).toBe(-30_00)
    // pure poker: no tournaments, casino stripped out
    expect(day.rooms[0].pokerProfitUsd).toBe(0)
    // KPI totals are pure poker
    expect(day.totalUsd).toBe(0)
  })

  it('keeps tournament profit clean of casino and reconciles the day total', () => {
    upsertBalance(pokerdon, '2026-09-09', 100_00, 'USD')
    createTransaction({ roomId: pokerdon, type: 'casino', amount: -20_00, currency: 'USD', date: '2026-09-10' })
    upsertBalance(pokerdon, '2026-09-10', 120_00, 'USD')
    replaceDayTournaments(pokerdon, '2026-09-10', [{ buyin: 50_00, result: 90_00, currency: 'USD' }])

    const day = sessionsInRange('2026-09-10', '2026-09-10')[0]
    // delta = 120 − 100 = +20; casino −20 ⇒ poker = +40
    expect(day.rooms[0].profitUsd).toBe(20_00)
    expect(day.rooms[0].casinoUsd).toBe(-20_00)
    expect(day.rooms[0].pokerProfitUsd).toBe(40_00)
    expect(day.totalUsd).toBe(40_00)
  })
})

describe('transfers between own rooms', () => {
  it('charges the sender amount+fee and credits the receiver amount', () => {
    createTransaction({
      roomId: pokerdon, type: 'transfer', amount: 30_00, fee: 1_00, currency: 'USD', destinationRoomId: redstar, date: '2026-09-10'
    })
    expect(getBalance(pokerdon, '2026-09-10')?.amount).toBe(-31_00)
    // RedStar chain is EUR: $30 at 1.1 ≈ €27.27
    expect(getBalance(redstar, '2026-09-10')?.amount).toBe(27_27)
  })

  it('converts the receiving leg into the destination currency with the day rate', () => {
    const rub = createRoom({ name: 'RubCoin', cashCurrency: 'RUB', tournamentCurrency: 'RUB' }).id
    createTransaction({
      roomId: pokerdon, type: 'transfer', amount: 10_00, fee: 50, currency: 'USD', destinationRoomId: rub, date: '2026-09-10'
    })
    // 10 USD by USD→RUB 90 → 900.00 RUB credited (fee only on the sender side)
    expect(getBalance(pokerdon, '2026-09-10')?.amount).toBe(-10_50)
    expect(getBalance(rub, '2026-09-10')?.amount).toBe(900_00)
    expect(getBalance(rub, '2026-09-10')?.currency).toBe('RUB')
  })

  it('removes auto entries on both rooms when a transfer is deleted', () => {
    const t = createTransaction({
      roomId: pokerdon, type: 'transfer', amount: 50_00, currency: 'USD', destinationRoomId: redstar, date: '2026-09-09'
    })
    expect(getBalance(pokerdon, '2026-09-09')).not.toBeNull()
    expect(getBalance(redstar, '2026-09-09')).not.toBeNull()
    deleteTransaction(t.id)
    expect(getBalance(pokerdon, '2026-09-09')).toBeNull()
    expect(getBalance(redstar, '2026-09-09')).toBeNull()
  })

  it('re-derives both rooms when a transfer destination is moved', () => {
    const rub = createRoom({ name: 'RubCoin', cashCurrency: 'RUB', tournamentCurrency: 'RUB' }).id
    const t = createTransaction({
      roomId: pokerdon, type: 'transfer', amount: 50_00, currency: 'USD', destinationRoomId: redstar, date: '2026-09-09'
    })
    updateTransaction(t.id, {
      roomId: pokerdon, type: 'transfer', amount: 50_00, currency: 'USD', destinationRoomId: rub, date: '2026-09-10'
    })
    expect(getBalance(redstar, '2026-09-09')).toBeNull()
    expect(getBalance(rub, '2026-09-10')?.amount).toBe(4_500_00) // $50 → 4500 RUB at 90
    expect(getBalance(pokerdon, '2026-09-10')?.amount).toBe(-50_00)
  })

  it('keeps a transfer out of sessions on auto-only days in both rooms', () => {
    createTransaction({
      roomId: pokerdon, type: 'transfer', amount: 100_00, fee: 1_00, currency: 'USD', destinationRoomId: redstar, date: '2026-09-10'
    })
    const days = sessionsInRange('2026-09-10', '2026-09-10')
    expect(days).toHaveLength(0)
  })
})