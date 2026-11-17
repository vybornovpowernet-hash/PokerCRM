import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpendingWidget } from '../src/components/SpendingWidget'
import TransactionsPage from '../src/pages/Transactions'
import { emptyMoneyOverview } from './setup'
import { pickOption, selectValue } from './select-helper'
import type { MoneyOverview, Room } from '../src/lib/types'

const mocks = vi.hoisted(() => ({
  roomsList: vi.fn(),
  transactionsList: vi.fn(),
  overview: vi.fn(),
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
      overview: mocks.overview,
      create: mocks.create,
      update: mocks.update,
      remove: mocks.remove,
      writeoffDiscrepancy: mocks.writeoff
    },
    tournaments: { acknowledgeDiscrepancy: mocks.acknowledge },
    rates: { status: vi.fn(), suggest: mocks.suggest }
  }
}))

// Сегодня — 10 ноября 2026: период по умолчанию обязан быть текущим месяцем.
const TODAY = new Date(2026, 10, 10, 12, 0, 0)

const rooms: Room[] = [
  { id: 9, name: 'Bybit', cashCurrency: 'USD', tournamentCurrency: 'USD', rateSource: null, color: '#f1f5f9', isWallet: true, createdAt: '2026-09-01 00:00:00' },
  { id: 2, name: 'PokerDom', cashCurrency: 'RUB', tournamentCurrency: 'RUB', rateSource: 'pokerdom', color: '#6ee7b7', isWallet: false, createdAt: '2026-09-01 00:00:00' },
  { id: 7, name: 'RedStar', cashCurrency: 'EUR', tournamentCurrency: 'EUR', rateSource: 'er-api', color: '#fda4af', isWallet: false, createdAt: '2026-09-01 00:00:00' }
]

/**
 * Числа зеркалят серверный ответ: `costs.totalUsd` сложил сервер, клиент только
 * показывает. kurсовая разница входит в «Комиссии» (411 + 263 = 674).
 */
function overviewFixture(overrides: Partial<MoneyOverview> = {}): MoneyOverview {
  const base = emptyMoneyOverview()
  return {
    ...base,
    period: { dateFrom: '2026-11-01', dateTo: '2026-11-10' },
    cash: { depositedUsd: 10_115, withdrawnUsd: 2_000, netInUsd: 8_115, missingRateRows: 0 },
    fees: {
      totalUsd: 411,
      rows: 5,
      missingRateRows: 0,
      byType: {
        deposit: { usd: 151, count: 2 },
        withdraw: { usd: 130, count: 2 },
        transfer: { usd: 130, count: 1 }
      },
      byCurrency: { USD: 410, RUB: 100 },
      byRoom: [
        { roomId: 9, name: 'Bybit', usd: 410, count: 3 },
        { roomId: 2, name: 'PokerDom', usd: 1, count: 1 }
      ]
    },
    casino: {
      totalUsd: -15_468,
      winsUsd: 16,
      lossesUsd: -15_484,
      manualUsd: -14_484,
      autoUsd: -984,
      rows: 3,
      missingRateRows: 0,
      byReason: { casino: { usd: 0, count: 0 }, fx: { usd: -984, count: 2 }, other: { usd: 0, count: 0 } }
    },
    bonus: { totalUsd: 4_000, creditedUsd: 5_000, withheldUsd: -1_000, rows: 2, missingRateRows: 0 },
    fx: { lossesUsd: 265, gainsUsd: 2, netLossUsd: 263, rows: 2, excluded: { noDestAmount: 1, sameCurrency: 12, noRate: 1 } },
    costs: {
      totalUsd: 674,
      feesUsd: 411,
      fxNetLossUsd: 263,
      fxLossesUsd: 265,
      fxGainsUsd: 2,
      missingRateRows: 0,
      fxNotCountedTransfers: 2
    },
    rooms: [
      { roomId: 9, name: 'Bybit', depositedUsd: 10_000, withdrawnUsd: 2_000, feesUsd: 410, casinoUsd: 0, bonusUsd: 3_000, fxUsd: 265, costsUsd: 675, transfersOut: 3, transfersIn: 6 },
      { roomId: 2, name: 'PokerDom', depositedUsd: 115, withdrawnUsd: 0, feesUsd: 1, casinoUsd: -15_468, bonusUsd: 1_000, fxUsd: -2, costsUsd: -1, transfersOut: 1, transfersIn: 1 }
    ],
    routes: [
      { fromRoomId: 9, fromRoomName: 'Bybit', toRoomId: 2, toRoomName: 'PokerDom', count: 5, feeUsd: 650, fxUsd: -2, costsUsd: 648, feeByCurrency: { USD: 650 } },
      { fromRoomId: 7, fromRoomName: 'RedStar', toRoomId: 9, toRoomName: 'Bybit', count: 2, feeUsd: 0, fxUsd: 265, costsUsd: 265, feeByCurrency: { EUR: 0 } },
      { fromRoomId: 6, fromRoomName: '1win', toRoomId: null, toRoomName: '—', count: 1, feeUsd: 0, fxUsd: 0, costsUsd: 0, feeByCurrency: { RUB: 0 } }
    ],
    ...overrides
  }
}

const region = (name: string) => screen.getByRole('region', { name })

/** Значение карточки/строки: сосед `[data-value]` того же контейнера. */
function valueNear(scope: HTMLElement, label: string): HTMLElement {
  const labelNode = within(scope).getByText(label)
  const value = labelNode.parentElement?.querySelector('[data-value]')
  if (!value) throw new Error(`нет значения рядом с «${label}»`)
  return value as HTMLElement
}

/** Раскрыть подробности и вернуть их контейнер. */
async function openDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Подробнее' }))
  await waitFor(() => expect(screen.queryByText('Прямые комиссии')).toBeTruthy())
  return screen.getByRole('button', { name: 'Подробнее' })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  mocks.roomsList.mockReset().mockResolvedValue(rooms)
  mocks.transactionsList.mockReset().mockResolvedValue({ transactions: [], discrepancies: [] })
  mocks.overview.mockReset().mockResolvedValue(overviewFixture())
  mocks.create.mockReset().mockResolvedValue({ id: 1 })
  mocks.update.mockReset().mockResolvedValue({ id: 1 })
  mocks.remove.mockReset().mockResolvedValue({ ok: true })
  mocks.writeoff.mockReset().mockResolvedValue({})
  mocks.acknowledge.mockReset().mockResolvedValue({})
  mocks.suggest.mockReset().mockResolvedValue({ rate: null, suggestedAmount: null })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function renderWidget() {
  render(<SpendingWidget rooms={rooms} />)
  await screen.findByText('Куда уходят деньги')
  await waitFor(() => expect(mocks.overview).toHaveBeenCalled())
}

describe('период виджета', () => {
  it('берёт текущий месяц и отправляет dateFrom и dateTo', async () => {
    await renderWidget()
    expect(mocks.overview).toHaveBeenCalledWith('2026-11-01', '2026-11-10')
    expect((screen.getByLabelText('Начало') as HTMLInputElement).value).toBe('2026-11-01')
    expect((screen.getByLabelText('Конец') as HTMLInputElement).value).toBe('2026-11-10')
  })

  it('смена периода вызывает новый запрос', async () => {
    await renderWidget()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'За год' }))
    await waitFor(() => expect(mocks.overview).toHaveBeenLastCalledWith('2026-01-01', '2026-11-10'))
    expect(mocks.overview).toHaveBeenCalledTimes(2)
  })

  it('неполный период: без запроса и с подсказкой «Выберите период»', async () => {
    await renderWidget()
    const calls = mocks.overview.mock.calls.length
    fireEvent.change(screen.getByLabelText('Начало'), { target: { value: '' } })
    expect(await screen.findByText('Выберите период')).toBeTruthy()
    await new Promise((r) => setTimeout(r, 0))
    expect(mocks.overview).toHaveBeenCalledTimes(calls)
    expect(screen.queryByRole('region', { name: 'Сводка за период' })).toBeNull()
  })

  it('не зависит от фильтров истории: смена фильтра операций не трогает виджет', async () => {
    render(<TransactionsPage />)
    await screen.findByText('Куда уходят деньги')
    await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(1))

    await pickOption(userEvent.setup(), 'Фильтр по типу', 'Вывод')
    await waitFor(() => expect(mocks.transactionsList).toHaveBeenCalled())
    expect(mocks.overview).toHaveBeenCalledTimes(1)
    expect(mocks.overview).toHaveBeenCalledWith('2026-11-01', '2026-11-10')
  })
})

describe('верхний ряд: ровно шесть карточек', () => {
  it('карточки: Внесено, Выведено, третья, Комиссии, Казино, Бонусы — и ничего сверху больше', async () => {
    await renderWidget()
    const summary = region('Сводка за период')
    for (const label of ['Внесено', 'Выведено', 'Осталось отбить', 'Комиссии', 'Казино', 'Бонусы']) {
      expect(within(summary).getByText(label)).toBeTruthy()
    }
    expect(summary.querySelectorAll('[data-value]')).toHaveLength(6)
    // карточка бонусов — про заработок рума, а не про внесённое: в «Внесено» этих денег нет
    expect(valueNear(summary, 'Бонусы').textContent).toBe('$40.00')
    expect(valueNear(summary, 'Бонусы').className).toContain('text-emerald-400')
    expect(within(summary).getByText('2 операции')).toBeTruthy()
    // карточки «Курсовая разница» и целого блока курсовой разницы больше нет
    expect(screen.queryByText('Курсовая разница')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Курсовая разница по переводам' })).toBeNull()
    expect(screen.queryByText('Чистый внос')).toBeNull()
    expect(screen.queryByText('внесено минус выведено, без комиссий и переводов')).toBeNull()
  })

  it('Внесено белое, Выведено зелёное', async () => {
    await renderWidget()
    const summary = region('Сводка за период')
    expect(valueNear(summary, 'Внесено').className).toContain('text-slate-100')
    expect(valueNear(summary, 'Выведено').className).toContain('text-emerald-400')
    expect(valueNear(summary, 'Внесено').textContent).toBe('$101.15')
    expect(valueNear(summary, 'Выведено').textContent).toBe('$20.00')
  })

  it('третья карточка при плюсе: «Осталось отбить», без знака, белая, без подписи', async () => {
    await renderWidget()
    const summary = region('Сводка за период')
    expect(valueNear(summary, 'Осталось отбить').textContent).toBe('$81.15')
    expect(valueNear(summary, 'Осталось отбить').className).toContain('text-slate-100')
    expect(valueNear(summary, 'Осталось отбить').className).not.toContain('text-red')
    expect(valueNear(summary, 'Осталось отбить').className).not.toContain('text-emerald')
    // пояснительной подписи под числом нет — формула живёт только во всплывающей подсказке
    expect(summary.textContent).not.toContain('внесено минус выведено')
    expect(screen.getByTitle('Внесено минус выведено')).toBeTruthy()
  })

  it('третья карточка при минусе: «В плюсе», модуль со знаком плюс, зелёная', async () => {
    mocks.overview.mockResolvedValue(
      overviewFixture({ cash: { depositedUsd: 2_000, withdrawnUsd: 22_000, netInUsd: -20_000, missingRateRows: 0 } })
    )
    await renderWidget()
    const summary = region('Сводка за период')
    expect(within(summary).queryByText('Осталось отбить')).toBeNull()
    expect(valueNear(summary, 'В плюсе').textContent).toBe('+$200.00')
    expect(valueNear(summary, 'В плюсе').className).toContain('text-emerald-400')
    expect(valueNear(summary, 'В плюсе').className).not.toContain('text-red')
    expect(screen.getByTitle('Внесено минус выведено')).toBeTruthy()
  })

  it('третья карточка при нуле: «Вышли в ноль», $0.00, белая', async () => {
    mocks.overview.mockResolvedValue(
      overviewFixture({ cash: { depositedUsd: 5_000, withdrawnUsd: 5_000, netInUsd: 0, missingRateRows: 0 } })
    )
    await renderWidget()
    const summary = region('Сводка за период')
    expect(valueNear(summary, 'Вышли в ноль').textContent).toBe('$0.00')
    expect(valueNear(summary, 'Вышли в ноль').className).toContain('text-slate-100')
    expect(valueNear(summary, 'Вышли в ноль').className).not.toContain('text-red')
  })

  it('красного у третьей карточки не бывает ни при одном знаке', async () => {
    for (const net of [8_115, -20_000, 0]) {
      mocks.overview.mockResolvedValue(
        overviewFixture({ cash: { depositedUsd: 10_115, withdrawnUsd: 2_000, netInUsd: net, missingRateRows: 0 } })
      )
      const { unmount } = render(<SpendingWidget rooms={rooms} />)
      await screen.findByText('Куда уходят деньги')
      const summary = region('Сводка за период')
      const value = summary.querySelectorAll('[data-value]')[2] as HTMLElement | undefined
      if (!value) throw new Error('в сводке нет третьей карточки')
      expect(value.className).not.toContain('text-red')
      unmount()
    }
  })

  it('Казино красное при убытке и показывает число операций', async () => {
    await renderWidget()
    const summary = region('Сводка за период')
    expect(valueNear(summary, 'Казино').textContent).toBe('-$154.68')
    expect(valueNear(summary, 'Казино').className).toContain('text-red-400')
    expect(within(summary).getByText('3 операции')).toBeTruthy()
  })
})

describe('карточка «Комиссии»: комиссии и курсовая разница вместе', () => {
  it('красная при положительном итоге и показывает, из чего он сложён', async () => {
    await renderWidget()
    const summary = region('Сводка за период')
    expect(valueNear(summary, 'Комиссии').textContent).toBe('$6.74')
    expect(valueNear(summary, 'Комиссии').className).toContain('text-red-400')
    expect(within(summary).getByText('прямые $4.11 · на курсе $2.63')).toBeTruthy()
  })

  it('при выигрыше на курсе подпись меняется, а сумма остаётся серверной', async () => {
    mocks.overview.mockResolvedValue(
      overviewFixture({
        costs: { totalUsd: -263, feesUsd: 0, fxNetLossUsd: -263, fxLossesUsd: 0, fxGainsUsd: 263, missingRateRows: 0, fxNotCountedTransfers: 0 }
      })
    )
    await renderWidget()
    const summary = region('Сводка за период')
    expect(valueNear(summary, 'Комиссии').textContent).toBe('-$2.63')
    expect(valueNear(summary, 'Комиссии').className).toContain('text-emerald-400')
    expect(within(summary).getByText('прямые $0.00 · на курсе выгода $2.63')).toBeTruthy()
  })

  it('нулевые комиссии — белые', async () => {
    mocks.overview.mockResolvedValue(overviewFixture({ ...emptyMoneyOverview(), cash: { depositedUsd: 1, withdrawnUsd: 0, netInUsd: 1, missingRateRows: 0 } }))
    await renderWidget()
    const summary = region('Сводка за период')
    expect(valueNear(summary, 'Комиссии').className).toContain('text-slate-100')
  })

  it('«курс не учтён у N переводов» видно только при счётчике больше нуля', async () => {
    await renderWidget()
    expect(await screen.findByText('курс не учтён у 2 переводов')).toBeTruthy()
  })

  it('склонение счётчика непосчитанных переводов', async () => {
    mocks.overview.mockResolvedValue(overviewFixture({ costs: { ...overviewFixture().costs, fxNotCountedTransfers: 1 } }))
    render(<SpendingWidget rooms={rooms} />)
    expect(await screen.findByText('курс не учтён у 1 перевода')).toBeTruthy()
  })

  it('при нуле счётчика строки нет', async () => {
    mocks.overview.mockResolvedValue(overviewFixture({ costs: { ...overviewFixture().costs, fxNotCountedTransfers: 0 } }))
    render(<SpendingWidget rooms={rooms} />)
    await screen.findByText('Куда уходят деньги')
    await waitFor(() => expect(mocks.overview).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText(/курс не учтён/)).toBeNull()
  })

  it('янтарное предупреждение об отсутствии курса в карточке комиссий', async () => {
    mocks.overview.mockResolvedValue(overviewFixture({ costs: { ...overviewFixture().costs, missingRateRows: 3 } }))
    await renderWidget()
    expect(await screen.findByText('нет курса по 3 операциям, сумма неполная')).toBeTruthy()
    expect(screen.queryByText(/нет курса по 1 операциям/)).toBeNull()
  })
})

describe('подробности под кнопкой «Подробнее»', () => {
  it('по умолчанию свёрнуто и отсутствует в DOM', async () => {
    await renderWidget()
    const button = screen.getByRole('button', { name: 'Подробнее' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Прямые комиссии')).toBeNull()
    expect(screen.queryByText('Потери на курсе')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('клик раскрывает, aria-expanded меняется, повторный клик сворачивает', async () => {
    await renderWidget()
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: 'Подробнее' })
    await user.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Прямые комиссии')).toBeTruthy()
    await user.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Прямые комиссии')).toBeNull()
  })

  it('комиссии: прямые с итогом, по типам с числом операций, потери и выгоды, итого серверное', async () => {
    await renderWidget()
    await openDetails(userEvent.setup())
    const fees = region('Комиссии')
    expect(valueNear(fees, 'Прямые комиссии').textContent).toBe('$4.11')
    expect(valueNear(fees, 'Депозит').textContent).toBe('$1.51 · 2')
    expect(valueNear(fees, 'Вывод').textContent).toBe('$1.30 · 2')
    expect(valueNear(fees, 'Перевод').textContent).toBe('$1.30 · 1')
    expect(valueNear(fees, 'Потери на курсе').textContent).toBe('$2.65')
    expect(valueNear(fees, 'Потери на курсе').className).toContain('text-red-400')
    expect(valueNear(fees, 'Выгоды на курсе').textContent).toBe('$0.02')
    expect(valueNear(fees, 'Выгоды на курсе').className).toContain('text-emerald-400')
    // «Итого» равно costs.totalUsd как пришло: в фикстуре 674, а не 411 + 263 в другом порядке
    expect(valueNear(fees, 'Итого').textContent).toBe('$6.74')
  })

  it('итог не пересчитывается: серверный costs.totalUsd показывается как есть', async () => {
    mocks.overview.mockResolvedValue(
      overviewFixture({
        costs: { totalUsd: 700, feesUsd: 411, fxNetLossUsd: 263, fxLossesUsd: 265, fxGainsUsd: 2, missingRateRows: 0, fxNotCountedTransfers: 0 }
      })
    )
    await renderWidget()
    await openDetails(userEvent.setup())
    expect(valueNear(region('Комиссии'), 'Итого').textContent).toBe('$7.00')
    expect(region('Комиссии').textContent).not.toContain('$6.74')
  })

  it('казино: выигрыши, проигрыши, вручную, авто-списания и причины', async () => {
    await renderWidget()
    await openDetails(userEvent.setup())
    const casino = region('Казино')
    expect(valueNear(casino, 'Выигрыши').textContent).toBe('$0.16')
    expect(valueNear(casino, 'Выигрыши').className).toContain('text-emerald-400')
    expect(valueNear(casino, 'Проигрыши').textContent).toBe('-$154.84')
    expect(valueNear(casino, 'Проигрыши').className).toContain('text-red-400')
    expect(valueNear(casino, 'Записано вручную').textContent).toBe('-$144.84')
    expect(valueNear(casino, 'Авто-списания').textContent).toBe('-$9.84')
    expect(valueNear(casino, 'Списание на курс').textContent).toBe('-$9.84 · 2')
    expect(within(casino).getByText('ваши ручные списания остатка дня, в Комиссии не входят')).toBeTruthy()
    // прежнего названия причины в этом виджете нет
    expect(within(casino).queryByText('Разница курсов')).toBeNull()
  })

  it('бонусы: начисления, удержания и итог — отдельный блок, не «Казино»', async () => {
    await renderWidget()
    await openDetails(userEvent.setup())
    const bonus = region('Бонусы')
    expect(valueNear(bonus, 'Начисления').textContent).toBe('$50.00')
    expect(valueNear(bonus, 'Начисления').className).toContain('text-emerald-400')
    expect(valueNear(bonus, 'Удержания').textContent).toBe('-$10.00')
    expect(valueNear(bonus, 'Удержания').className).toContain('text-red-400')
    expect(valueNear(bonus, 'Итого').textContent).toBe('$40.00')
    // бонусы не смешиваются с казино: в блоке казино их строк нет
    expect(within(region('Казино')).queryByText('Начисления')).toBeNull()
    expect(within(region('Казино')).queryByText('Удержания')).toBeNull()
  })

  it('бонусы: янтарная строка про отсутствие курса говорит, что итог неполный', async () => {
    const withoutRate = overviewFixture()
    withoutRate.bonus = { totalUsd: 5_000, creditedUsd: 5_000, withheldUsd: 0, rows: 2, missingRateRows: 1 }
    mocks.overview.mockResolvedValue(withoutRate)
    await renderWidget()
    await openDetails(userEvent.setup())
    expect(within(region('Бонусы')).getByText('нет курса по 1 строке бонуса — суммы неполные')).toBeTruthy()
  })

  it('не показывает причину и типы без строк', async () => {
    const without = overviewFixture()
    without.fees.byType = { deposit: { usd: 151, count: 2 }, withdraw: { usd: 0, count: 0 }, transfer: { usd: 0, count: 0 } }
    without.casino.byReason = { casino: { usd: 0, count: 0 }, fx: { usd: 0, count: 0 }, other: { usd: 0, count: 0 } }
    mocks.overview.mockResolvedValue(without)
    await renderWidget()
    await openDetails(userEvent.setup())
    const casino = region('Казино')
    // причина «Казино» не показана: в блоке осталась одна строка с этим словом — его заголовок
    expect(within(casino).getAllByText('Казино')).toHaveLength(1)
    expect(within(casino).queryByText('Прочее')).toBeNull()
    expect(within(casino).queryByText('Списание на курс')).toBeNull()
    expect(within(casino).queryByText(/нет курса по/)).toBeNull()
    expect(within(casino).queryByText('ваши ручные списания остатка дня, в Комиссии не входят')).toBeNull()
    const fees = region('Комиссии')
    expect(within(fees).queryByText('Перевод')).toBeNull()
    expect(within(fees).queryByText('Вывод')).toBeNull()
  })
})

describe('таблицы в подробностях', () => {
  it('по румам: имя в цвете рума, колонки и стоимость рума', async () => {
    await renderWidget()
    await openDetails(userEvent.setup())
    const table = screen.getByRole('table', { name: 'Куда уходят деньги по румам' })
    for (const column of ['Рум', 'Внесено', 'Выведено', 'Комиссии', 'Казино', 'Бонусы']) {
      expect(within(table).getByText(column)).toBeTruthy()
    }
    expect(within(table).queryByText(/Курс/)).toBeNull()
    expect(within(table).getByText('PokerDom').getAttribute('style')).toContain('rgb(110, 231, 183)')
    expect(within(table).getByText('$6.75')).toBeTruthy()
    expect(within(table).getByText('-$0.01')).toBeTruthy()
    expect(within(table).getByText('-$154.68')).toBeTruthy()
  })

  it('куда шли переводы: маршруты, число и стоимость; без сумм переводов', async () => {
    await renderWidget()
    await openDetails(userEvent.setup())
    const table = screen.getByRole('table', { name: 'Куда шли переводы' })
    expect(within(table).getByText('Откуда → Куда')).toBeTruthy()
    expect(within(table).getByText('Переводов')).toBeTruthy()
    expect(within(table).getByText('Комиссии')).toBeTruthy()
    expect(within(table).queryByText(/Переведено|Сумма переводов|Итого переводов/)).toBeNull()
    const rows = within(table).getAllByRole('row')
    const bybitRow = rows.find((r) => within(r).queryByText('PokerDom')) as HTMLElement
    expect(within(bybitRow).getByText('5')).toBeTruthy()
    expect(within(bybitRow).getByText('$6.48')).toBeTruthy()
    // удалённый получатель и нулевая стоимость маршрута: прочерки вместо null и $0.00
    const goneRow = rows.find((r) => within(r).queryByText('1win')) as HTMLElement
    expect(within(goneRow).getAllByText('—').length).toBe(2)
    expect(within(goneRow).queryByText('$0.00')).toBeNull()
  })

  it('слово «лента» не встречается ни в сводке, ни в подробностях', async () => {
    await renderWidget()
    await openDetails(userEvent.setup())
    expect(screen.queryByText(/лент/)).toBeNull()
    expect(document.body.textContent).not.toMatch(/лент/)
  })
})

describe('состояния', () => {
  it('загрузка: скелет, без нулей', async () => {
    const gate = deferred<MoneyOverview>()
    mocks.overview.mockReturnValue(gate.promise)
    render(<SpendingWidget rooms={rooms} />)
    await screen.findByText('Куда уходят деньги')
    expect(screen.getByRole('status', { name: 'Загрузка данных' })).toBeTruthy()
    expect(screen.queryByText(/\$/)).toBeNull()
    expect(screen.queryByText('За период операций нет')).toBeNull()
    gate.resolve(overviewFixture())
    expect(await screen.findByText('$6.74')).toBeTruthy()
  })

  it('ошибка с кнопкой «Повторить»', async () => {
    mocks.overview.mockRejectedValueOnce(new Error('сервер недоступен'))
    render(<SpendingWidget rooms={rooms} />)
    expect(await screen.findByText('сервер недоступен')).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('$6.74')).toBeTruthy()
  })

  it('пустой период', async () => {
    mocks.overview.mockResolvedValue(emptyMoneyOverview())
    await renderWidget()
    expect(await screen.findByText('За период операций нет')).toBeTruthy()
    expect(screen.queryByText(/\$/)).toBeNull()
  })

  it('null вместо числа — прочерк, а не ноль', async () => {
    const broken = structuredClone(overviewFixture()) as unknown as { costs: { totalUsd: number | null } }
    broken.costs.totalUsd = null
    mocks.overview.mockResolvedValue(broken as unknown as MoneyOverview)
    await renderWidget()
    expect(valueNear(region('Сводка за период'), 'Комиссии').textContent).toBe('—')
    expect(screen.queryByText('$0.00')).toBeNull()
  })

  it('опоздавший ответ прежнего периода игнорируется', async () => {
    const slow = deferred<MoneyOverview>()
    mocks.overview
      .mockImplementationOnce(() => slow.promise)
      .mockImplementationOnce(() =>
        Promise.resolve(overviewFixture({ cash: { depositedUsd: 55_500, withdrawnUsd: 0, netInUsd: 55_500, missingRateRows: 0 } }))
      )
    render(<SpendingWidget rooms={rooms} />)
    await screen.findByText('Куда уходят деньги')
    await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(1))

    await userEvent.setup().click(screen.getByRole('button', { name: 'За год' }))
    await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(valueNear(region('Сводка за период'), 'Осталось отбить').textContent).toBe('$555.00'))

    slow.resolve(overviewFixture())
    await new Promise((r) => setTimeout(r, 0))
    expect(valueNear(region('Сводка за период'), 'Осталось отбить').textContent).toBe('$555.00')
    expect(screen.queryByText('$81.15')).toBeNull()
  })
})

describe('перезапрос после правок операций', () => {
  async function renderPage() {
    render(<TransactionsPage />)
    await screen.findByText('Куда уходят деньги')
    await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(1))
  }

  it('после добавления операции', async () => {
    await renderPage()
    const user = userEvent.setup()
    await waitFor(() => expect(selectValue('Рум')).toBe('Bybit · USD'))
    await user.type(screen.getByPlaceholderText('100.00'), '50')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalled())
    await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(2))
  })

  it('после правки операции', async () => {
    mocks.transactionsList.mockResolvedValue({ transactions: [row(42, 'deposit', 'in', 5_000)], discrepancies: [] })
    await renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Изменить' }))
    await waitFor(() => expect((screen.getByPlaceholderText('100.00') as HTMLInputElement).value).toBe('50'))
    await user.type(screen.getByPlaceholderText('100.00'), '0')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalled())
    await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(2))
  })

  it('после удаления операции', async () => {
    mocks.transactionsList.mockResolvedValue({ transactions: [row(43, 'withdraw', 'out', 2_000)], discrepancies: [] })
    await renderPage()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(43))
    await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(2))
  })
})

/** Промис с ручной отдачей: тест решает, когда придёт ответ. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function row(id: number, type: 'deposit' | 'withdraw', direction: 'in' | 'out', amount: number) {
  return {
    id,
    roomId: 9,
    roomName: 'Bybit',
    type,
    amount,
    fee: 0,
    currency: 'USD',
    direction,
    counterpart: null,
    destinationRoomId: null,
    destinationRoomName: null,
    destAmount: null,
    destCurrency: null,
    date: '2026-11-05',
    comment: null,
    createdAt: '2026-11-05 10:00:00',
    amountUsd: amount,
    feeUsd: 0,
    fxExpectedDest: null,
    fxDiffUsd: null,
    costUsd: 0,
    writeoff: false,
    writeoffReason: null
  }
}
