import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BalancesPage from '../src/pages/Balances'
import type { CurrentBalances, Room } from '../src/lib/types'

const mocks = vi.hoisted(() => ({
  roomsList: vi.fn(),
  current: vi.fn(),
  upsert: vi.fn()
}))

vi.mock('../src/lib/api', () => ({
  api: {
    rooms: { list: mocks.roomsList },
    balances: { current: mocks.current, upsert: mocks.upsert }
  }
}))

const bybit: Room = {
  id: 9,
  name: 'Bybit',
  cashCurrency: 'USD',
  tournamentCurrency: 'USD',
  rateSource: null,
  color: '#f1f5f9',
  isWallet: true,
  createdAt: '2026-09-18 00:00:00'
}

const gg: Room = {
  id: 1,
  name: 'GG',
  cashCurrency: 'USD',
  tournamentCurrency: 'USD',
  rateSource: null,
  color: '#fde68a',
  isWallet: false,
  createdAt: '2026-09-18 00:00:00'
}

const pokerdom: Room = {
  id: 2,
  name: 'PokerDom',
  cashCurrency: 'USD',
  tournamentCurrency: 'USD',
  rateSource: 'pokerdom',
  color: '#6ee7b7',
  isWallet: false,
  createdAt: '2026-09-18 00:00:00'
}

type BalanceRow = CurrentBalances['balances'][number]

function entry(room: Room, amount: number, amountUsd: number | null = amount, overrides: Partial<BalanceRow> = {}): BalanceRow {
  return {
    roomId: room.id,
    roomName: room.name,
    date: '2026-09-18',
    amount,
    currency: room.cashCurrency,
    source: 'manual',
    amountUsd,
    staleRate: false,
    hasTournaments: false,
    pendingImport: false,
    ...overrides
  }
}

function rates(stale = true): CurrentBalances['rates'] {
  return {
    stale,
    usdRub: { rate: 91.25, date: '2026-09-18', updatedAt: '2026-09-18T09:00:00.000Z', stale: false },
    eurUsd: { rate: 1.0842, date: '2026-09-17', updatedAt: '2026-09-18T09:00:00.000Z', stale: true },
    cnyUsd: { rate: null, date: null, updatedAt: null, stale: true }
  }
}

let rooms: Room[] = []
let balances: BalanceRow[] = []
let totalUsd: number | null = null

function setBalances(next: BalanceRow[], total: number | null = null) {
  balances = next
  totalUsd = total
}

beforeEach(() => {
  rooms = [bybit]
  setBalances([entry(bybit, 10000)], 10000)
  mocks.roomsList.mockReset().mockImplementation(() => Promise.resolve(rooms))
  mocks.current.mockReset().mockImplementation(() => Promise.resolve({ balances, totalUsd, rates: rates() }))
  mocks.upsert.mockReset().mockImplementation((payload: { roomId: number; amount: number }) => {
    const room = rooms.find((item) => item.id === payload.roomId) ?? bybit
    setBalances([entry(room, payload.amount)], payload.amount)
    return Promise.resolve({})
  })
})

describe('BalancesPage — delta input', () => {
  it('starts empty with a placeholder and keeps the saved balance on the left', async () => {
    render(<BalancesPage />)

    const input = (await screen.findByLabelText('Новый баланс Bybit')) as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toBe('Новый баланс')
    expect(document.getElementById('balance-current-9')?.textContent).toBe('$100.00')
  })

  it('turns a typed comma into a dot, caps the fraction and shows the live delta', async () => {
    const user = userEvent.setup()
    render(<BalancesPage />)

    const input = (await screen.findByLabelText('Новый баланс Bybit')) as HTMLInputElement
    await user.type(input, '123,456')

    expect(input.value).toBe('123.45')
    expect(screen.getByText('+$23.45')).toBeTruthy()
  })

  it('keeps Записать disabled while the field is empty or unchanged', async () => {
    const user = userEvent.setup()
    render(<BalancesPage />)

    const input = (await screen.findByLabelText('Новый баланс Bybit')) as HTMLInputElement
    const button = screen.getByRole('button', { name: 'Записать баланс Bybit' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)

    await user.type(input, '100')
    expect(screen.queryByText('+$0.00')).toBeNull()
    expect(button.disabled).toBe(true)

    await user.type(input, '.5')
    expect(input.value).toBe('100.5')
    expect(screen.getByText('+$0.50')).toBeTruthy()
    expect(button.disabled).toBe(false)

    await user.clear(input)
    expect(button.disabled).toBe(true)
  })

  it('saves integer min units, clears the field and shows the new balance on the left', async () => {
    const user = userEvent.setup()
    render(<BalancesPage />)

    const input = (await screen.findByLabelText('Новый баланс Bybit')) as HTMLInputElement
    await user.type(input, '1234,56')
    expect(input.value).toBe('1\u00A0234.56')

    await user.click(screen.getByRole('button', { name: 'Записать баланс Bybit' }))

    await waitFor(() => expect(mocks.upsert).toHaveBeenCalledTimes(1))
    expect(mocks.upsert).toHaveBeenCalledWith({ roomId: 9, date: expect.any(String), amount: 123456, currency: 'USD' })

    await waitFor(() => expect(input.value).toBe(''))
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Баланс Bybit записан')
    expect(screen.getAllByText('$1\u00A0234.56', { normalizer: (text) => text }).length).toBeGreaterThan(0)
  })

  it('marks a negative balance with a subtle accent instead of a plain number', async () => {
    setBalances([entry(bybit, -79)], -79)
    render(<BalancesPage />)

    const current = await screen.findByTitle('отрицательный баланс')
    expect(current.textContent).toBe('-$0.79')
  })
})

describe('BalancesPage — распределение банкролла', () => {
  it('draws one colored segment per positive room and keeps the shares at exactly 100%', async () => {
    rooms = [gg, pokerdom, bybit]
    setBalances([entry(gg, 5400000), entry(pokerdom, 2000000), entry(bybit, -79)], 7399921)
    render(<BalancesPage />)

    expect(await screen.findByLabelText('Распределение банкролла по румам')).toBeTruthy()
    expect(screen.getByText('Распределение банкролла')).toBeTruthy()
    expect(screen.getByText('$73\u00A0999.21', { normalizer: (text) => text })).toBeTruthy()

    expect(screen.getByText('73%')).toBeTruthy()
    expect(screen.getByText('27%')).toBeTruthy()
    // the overdrawn wallet is called out in text, not folded into the bar
    const overdrawn = screen.getByText('отрицательные:').parentElement
    expect(overdrawn?.textContent).toContain('Bybit')
    expect(overdrawn?.textContent).toContain('-$0.79')
  })

  it('lists rooms without a rate instead of silently dropping them', async () => {
    rooms = [pokerdom, bybit]
    setBalances([entry(pokerdom, 500000, null), entry(bybit, 10000)])
    render(<BalancesPage />)

    expect(await screen.findByText('нет курса: PokerDom — не в распределении')).toBeTruthy()
    expect(screen.getByText('100%')).toBeTruthy()
  })

  it('explains an empty portfolio', async () => {
    setBalances([], null)
    render(<BalancesPage />)

    expect(await screen.findByText('нет записанных балансов — заполни строки ниже')).toBeTruthy()
  })
})

describe('BalancesPage — курсы по источникам', () => {
  it('shows each feed with its own rate and freshness instead of one aggregate', async () => {
    render(<BalancesPage />)

    expect(await screen.findByText('USD/RUB')).toBeTruthy()
    // USD/RUB is fresh, EUR/USD is stale, USD/CNY was never fetched
    expect(screen.getByText('91.2500')).toBeTruthy()
    expect(screen.getByText('1.0842')).toBeTruthy()
    expect(screen.getAllByRole('img', { name: 'актуально' })).toHaveLength(1)
    expect(screen.getAllByRole('img', { name: 'устарел' })).toHaveLength(1)
    expect(screen.getAllByRole('img', { name: 'нет данных' })).toHaveLength(1)
    // the aggregate line summarises the feeds rather than replacing them
    expect(screen.getByText('часть курсов устарела')).toBeTruthy()
  })
})
