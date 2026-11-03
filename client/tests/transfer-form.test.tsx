import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TransactionsPage from '../src/pages/Transactions'
import { formatUnits } from '../src/lib/money'

const mocks = vi.hoisted(() => ({
  roomsList: vi.fn(),
  transactionsList: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  writeoff: vi.fn(),
  acknowledge: vi.fn(),
  suggest: vi.fn()
}))

vi.mock('../src/lib/api', () => ({
  api: {
    rooms: { list: mocks.roomsList },
    transactions: {
      list: mocks.transactionsList,
      create: mocks.create,
      update: mocks.update,
      remove: mocks.remove,
      writeoffDiscrepancy: mocks.writeoff
    },
    tournaments: { acknowledgeDiscrepancy: mocks.acknowledge },
    rates: { status: vi.fn(), suggest: mocks.suggest }
  }
}))

const usdRoom = {
  id: 1,
  name: 'Bybit',
  cashCurrency: 'USD',
  tournamentCurrency: 'USD',
  rateSource: null,
  color: '#f1f5f9',
  isWallet: true,
  createdAt: '2026-11-01 00:00:00'
}
const rubRoom = {
  id: 2,
  name: 'PokerDom',
  cashCurrency: 'RUB',
  tournamentCurrency: 'RUB',
  rateSource: 'pokerdom',
  color: '#6ee7b7',
  isWallet: false,
  createdAt: '2026-11-01 00:00:00'
}

function selects() {
  return screen.getAllByRole('combobox')
}

function selectAt(index: number): HTMLElement {
  const el = selects()[index]
  if (!el) throw new Error(`combobox #${index} not found`)
  return el
}

async function renderLoaded() {
  mocks.transactionsList.mockResolvedValue({ transactions: [], discrepancies: [] })
  render(<TransactionsPage />)
  await screen.findByRole('heading', { name: 'Новая операция' })
  // the room selects only fill in after api.rooms.list resolves
  await waitFor(() => expect((selectAt(1) as HTMLSelectElement).value).toBe('1'))
}

async function chooseTransfer(fromId: string, toId: string) {
  const user = userEvent.setup()
  await user.selectOptions(selectAt(0), 'transfer')
  // the third select only becomes "Куда" after the type switch — re-read the list
  await user.selectOptions(selectAt(1), fromId)
  await user.selectOptions(selectAt(2), toId)
  return user
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.roomsList.mockResolvedValue([usdRoom, rubRoom])
  mocks.create.mockResolvedValue({ id: 1 })
  mocks.suggest.mockResolvedValue({ rate: 870200, suggestedAmount: 435100 })
})

describe('cross-currency transfer form', () => {
  it('shows the credited-amount field and prefills it from the rate suggestion', async () => {
    await renderLoaded()
    const user = await chooseTransfer('1', '2')
    await user.type(screen.getByPlaceholderText('100.00'), '50')

    const credited = (await screen.findByPlaceholderText('₽0.00')) as HTMLInputElement
    await waitFor(() => expect(credited.value).toBe(formatUnits(435100)))
    expect(mocks.suggest).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'USD', to: 'RUB', roomId: 2, amount: 5000 })
    )
    expect(screen.getByText(/Курс ленты: 87\.02/)).toBeTruthy()
  })

  it('keeps the user-typed exact figure over a newer suggestion and sends it in the payload', async () => {
    await renderLoaded()
    const user = await chooseTransfer('1', '2')
    await user.type(screen.getByPlaceholderText('100.00'), '50')

    const credited = (await screen.findByPlaceholderText('₽0.00')) as HTMLInputElement
    await waitFor(() => expect(credited.value).toBe(formatUnits(435100)))

    await user.clear(credited)
    await user.type(credited, '4247.59')
    // a newer suggestion must not overwrite the touched field
    mocks.suggest.mockResolvedValue({ rate: 870200, suggestedAmount: 999999 })
    const amountInput = screen.getByPlaceholderText('100.00')
    const callsBefore = mocks.suggest.mock.calls.length
    await user.clear(amountInput)
    await user.type(amountInput, '50')
    await waitFor(() => expect(mocks.suggest.mock.calls.length).toBeGreaterThan(callsBefore))
    await new Promise((r) => setTimeout(r, 0))
    expect(credited.value).toBe('4247.59')

    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'transfer',
          roomId: 1,
          destinationRoomId: 2,
          amount: 5000,
          destAmount: 424759
        })
      )
    )
  })

  it('hides the credited-amount field for a same-currency transfer', async () => {
    const usdRoom2 = { ...rubRoom, id: 3, name: 'GG', cashCurrency: 'USD', rateSource: null }
    mocks.roomsList.mockResolvedValue([usdRoom, usdRoom2])
    await renderLoaded()
    const user = await chooseTransfer('1', '3')
    await user.type(screen.getByPlaceholderText('100.00'), '50')

    expect(screen.queryByPlaceholderText('₽0.00')).toBeNull()
    expect(mocks.suggest).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ destAmount: null }))
    )
  })

  it('rejects an invalid credited amount with a Russian error', async () => {
    await renderLoaded()
    const user = await chooseTransfer('1', '2')
    await user.type(screen.getByPlaceholderText('100.00'), '50')
    const credited = (await screen.findByPlaceholderText('₽0.00')) as HTMLInputElement
    await user.clear(credited)
    await user.type(credited, '-5')

    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    expect(await screen.findByText(/Сумма зачисления должна быть положительной/)).toBeTruthy()
    expect(mocks.create).not.toHaveBeenCalled()
  })
})

const usdRoom2 = { ...usdRoom, id: 3, name: 'GG', cashCurrency: 'USD', rateSource: null }
const rubRoom2 = { ...rubRoom, id: 4, name: 'PokerStars', cashCurrency: 'RUB', rateSource: null }

async function renderRooms(list: unknown[]) {
  mocks.roomsList.mockResolvedValue(list)
  mocks.transactionsList.mockResolvedValue({ transactions: [], discrepancies: [] })
  render(<TransactionsPage />)
  await screen.findByRole('heading', { name: 'Новая операция' })
  await waitFor(() => expect((selectAt(1) as HTMLSelectElement).value).toBe('1'))
  return userEvent.setup()
}

async function typeExactCredited(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(selectAt(0), 'transfer')
  await user.selectOptions(selectAt(1), '1')
  await user.selectOptions(selectAt(2), '2')
  await user.type(screen.getByPlaceholderText('100.00'), '50')
  const credited = (await screen.findByPlaceholderText('₽0.00')) as HTMLInputElement
  await waitFor(() => expect(credited.value).toBe(formatUnits(435100)))
  await user.clear(credited)
  await user.type(credited, '4247.59')
  await waitFor(() => expect(credited.value).toBe('4247.59'))
  return credited
}

describe('stale exact amount after the currency pair changes', () => {
  it('drops the exact amount when the destination switches to the sender currency', async () => {
    const user = await renderRooms([usdRoom, rubRoom, usdRoom2])
    await typeExactCredited(user)

    await user.selectOptions(selectAt(2), '3')
    expect(screen.queryByPlaceholderText('₽0.00')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'transfer', roomId: 1, destinationRoomId: 3, amount: 5000, destAmount: null })
      )
    )
  })

  it('drops the exact amount when the source switches to the receiver currency', async () => {
    const user = await renderRooms([usdRoom, rubRoom, rubRoom2])
    await typeExactCredited(user)

    await user.selectOptions(selectAt(1), '4')
    expect(screen.queryByPlaceholderText('₽0.00')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'transfer', roomId: 4, destinationRoomId: 2, destAmount: null })
      )
    )
  })

  it('drops a stored exact amount while editing a transfer moved to a same-currency pair', async () => {
    mocks.roomsList.mockResolvedValue([usdRoom, rubRoom, usdRoom2])
    mocks.transactionsList.mockResolvedValue({
      transactions: [
        {
          id: 5,
          roomId: 1,
          roomName: 'Bybit',
          type: 'transfer',
          amount: 5000,
          fee: 0,
          currency: 'USD',
          direction: 'out',
          counterpart: null,
          destinationRoomId: 2,
          destinationRoomName: 'PokerDom',
          destAmount: 424759,
          destCurrency: 'RUB',
          date: '2026-11-03',
          comment: null,
          createdAt: '2026-11-03 10:00:00',
          amountUsd: 5000,
          writeoff: false,
          writeoffReason: null
        }
      ],
      discrepancies: []
    })
    render(<TransactionsPage />)
    await screen.findByRole('heading', { name: 'Новая операция' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Изменить' }))
    const credited = (await screen.findByPlaceholderText('₽0.00')) as HTMLInputElement
    await waitFor(() => expect(credited.value).toBe('4247.59'))

    await user.selectOptions(selectAt(2), '3')
    expect(screen.queryByPlaceholderText('₽0.00')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(
        5,
        expect.objectContaining({ roomId: 1, destinationRoomId: 3, destAmount: null })
      )
    )
  })
})
