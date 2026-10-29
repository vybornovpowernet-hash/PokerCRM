import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TransactionsPage from '../src/pages/Transactions'
import type { OrphanedDiscrepancy, Room } from '../src/lib/types'

const mocks = vi.hoisted(() => ({
  roomsList: vi.fn(),
  transactionsList: vi.fn(),
  acknowledgeDiscrepancy: vi.fn()
}))

vi.mock('../src/lib/api', () => ({
  api: {
    rooms: { list: mocks.roomsList },
    transactions: { list: mocks.transactionsList },
    tournaments: { acknowledgeDiscrepancy: mocks.acknowledgeDiscrepancy }
  }
}))

const room: Room = {
  id: 8,
  name: 'GG',
  cashCurrency: 'USD',
  tournamentCurrency: 'USD',
  rateSource: 'er-api',
  color: '#fde68a',
  isWallet: false,
  createdAt: '2026-10-01 00:00:00'
}

const discrepancy: OrphanedDiscrepancy = { date: '2026-10-22', roomId: 8, roomName: 'GG', amountUsd: -34_71 }

beforeEach(() => {
  mocks.roomsList.mockReset().mockResolvedValue([room])
  mocks.transactionsList
    .mockReset()
    .mockResolvedValueOnce({ transactions: [], discrepancies: [discrepancy] })
    .mockResolvedValue({ transactions: [], discrepancies: [] })
  mocks.acknowledgeDiscrepancy.mockReset().mockResolvedValue(undefined)
})

describe('TransactionsPage — принятие расхождения', () => {
  it('removes the warning row without writing a transaction', async () => {
    const user = userEvent.setup()
    render(<TransactionsPage />)

    expect(await screen.findByText('Расхождение')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Принять' }))

    await waitFor(() => expect(mocks.acknowledgeDiscrepancy).toHaveBeenCalledWith(8, '2026-10-22'))
    // the server state is re-read, so the accepted day is gone from the table
    await waitFor(() => expect(screen.queryByText('Расхождение')).toBeNull())
    expect(screen.queryByRole('button', { name: 'Списать' })).toBeNull()
    // no write-off modal was opened and no ledger row was requested
    expect(screen.queryByRole('button', { name: 'Списать расхождение' })).toBeNull()
  })
})
