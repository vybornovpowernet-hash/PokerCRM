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

const room: Room = {
  id: 9,
  name: 'Bybit',
  cashCurrency: 'USD',
  tournamentCurrency: 'USD',
  rateSource: null,
  color: '#f1f5f9',
  isWallet: true,
  createdAt: '2026-09-18 00:00:00'
}

function serverState(amount: number): CurrentBalances {
  return {
    balances: [
      {
        roomId: room.id,
        roomName: room.name,
        date: '2026-09-18',
        amount,
        currency: 'USD',
        source: 'manual',
        amountUsd: amount,
        staleRate: false,
        hasTournaments: false,
        pendingImport: false
      }
    ],
    totalUsd: amount,
    rates: { stale: false, usdRub: null, eurUsd: null }
  }
}

let serverAmount = 10000

beforeEach(() => {
  serverAmount = 10000
  mocks.roomsList.mockReset().mockResolvedValue([room])
  mocks.current.mockReset().mockImplementation(() => Promise.resolve(serverState(serverAmount)))
  mocks.upsert.mockReset().mockImplementation((payload: { amount: number }) => {
    serverAmount = payload.amount
    return Promise.resolve({})
  })
})

describe('BalancesPage — manual balance input', () => {
  it('keeps the saved value in the input after Записать (never resets to 0.00)', async () => {
    const user = userEvent.setup()
    render(<BalancesPage />)

    const input = (await screen.findByLabelText('Новый баланс Bybit')) as HTMLInputElement
    await waitFor(() => expect(input.value).toBe('100.00'))

    await user.clear(input)
    await user.type(input, '1234.56')
    await user.click(screen.getByRole('button', { name: 'Записать' }))

    await waitFor(() => expect(mocks.upsert).toHaveBeenCalledTimes(1))
    expect(mocks.upsert).toHaveBeenCalledWith({ roomId: 9, date: expect.any(String), amount: 123456, currency: 'USD' })

    await waitFor(() => expect(input.value).toBe('1 234.56'))
    expect(screen.getAllByText('$1234.56').length).toBeGreaterThan(0)
  })
})
