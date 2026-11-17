import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RoomsPage from '../src/pages/Rooms'
import { openOptionLabels, pickOption, selectValue } from './select-helper'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  templates: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  balancesCurrent: vi.fn()
}))

vi.mock('../src/lib/api', () => ({
  api: {
    rooms: {
      list: mocks.list,
      templates: mocks.templates,
      create: mocks.create,
      update: mocks.update,
      remove: mocks.remove
    },
    balances: { current: mocks.balancesCurrent }
  }
}))

const CURRENCIES = ['RUB', 'USD', 'EUR', 'CNY']

const room = {
  id: 1,
  name: 'Bybit',
  cashCurrency: 'USD',
  tournamentCurrency: 'USD',
  rateSource: null,
  color: '#f1f5f9',
  isWallet: true,
  createdAt: '2026-09-01 00:00:00'
}

async function renderPage() {
  render(<RoomsPage />)
  await screen.findByRole('heading', { name: 'Новый рум' })
  await waitFor(() => expect(mocks.list).toHaveBeenCalled())
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue([room])
  mocks.templates.mockResolvedValue([])
  mocks.create.mockResolvedValue({ id: 2 })
  mocks.update.mockResolvedValue({ id: 1 })
  mocks.remove.mockResolvedValue({ ok: true })
  mocks.balancesCurrent.mockResolvedValue({ balances: [], totalUsd: 0 })
})

describe('валюты рума: кастомные списки вместо системных', () => {
  it('на странице нет ни одного нативного <select>', async () => {
    await renderPage()
    expect(document.querySelector('select')).toBeNull()
    // два контрола валют; кнопка цвета — отдельный контрол, он не combobox
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
  })

  it('меню тёмное и полный набор валют allowlist', async () => {
    const user = userEvent.setup()
    await renderPage()

    await user.click(screen.getByRole('combobox', { name: 'Валюта кассы' }))
    expect(screen.getByRole('listbox').className).toContain('bg-slate-900')
    expect(openOptionLabels()).toEqual(CURRENCIES)
  })

  it('выбор валюты пишется в форму и доезжает до payload', async () => {
    const user = userEvent.setup()
    await renderPage()

    await pickOption(user, 'Валюта кассы', 'EUR')
    await pickOption(user, 'Валюта турниров', 'RUB')
    expect(selectValue('Валюта кассы')).toBe('EUR')

    await user.type(screen.getByPlaceholderText('Введи название или выбери шаблон…'), 'RedStar')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'RedStar', cashCurrency: 'EUR', tournamentCurrency: 'RUB' })
      )
    )
  })

  it('правка рума стартует с его валютами и сохраняет их обратно', async () => {
    const user = userEvent.setup()
    mocks.list.mockResolvedValue([{ ...room, cashCurrency: 'RUB', tournamentCurrency: 'USD' }])
    await renderPage()

    await user.click(screen.getByRole('button', { name: 'Изменить' }))
    expect(selectValue('Валюта кассы')).toBe('RUB')
    expect(selectValue('Валюта турниров')).toBe('USD')

    await pickOption(user, 'Валюта турниров', 'EUR')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ cashCurrency: 'RUB', tournamentCurrency: 'EUR' })
      )
    )
  })
})
