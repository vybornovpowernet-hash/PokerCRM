import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpendingWidget } from '../src/components/SpendingWidget'
import TransactionsPage from '../src/pages/Transactions'
import { emptyMoneyOverview } from './setup'
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

function overviewFixture(overrides: Partial<MoneyOverview> = {}): MoneyOverview {
  return {
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
    fx: { lossesUsd: 265, gainsUsd: 2, netLossUsd: 263, rows: 2, excluded: { noDestAmount: 2, sameCurrency: 12, noRate: 1 } },
    rooms: [
      { roomId: 9, name: 'Bybit', depositedUsd: 10_000, withdrawnUsd: 2_000, feesUsd: 410, casinoUsd: 0, fxUsd: 265, transfersOut: 3, transfersIn: 6 },
      { roomId: 2, name: 'PokerDom', depositedUsd: 115, withdrawnUsd: 0, feesUsd: 1, casinoUsd: -15_468, fxUsd: -2, transfersOut: 1, transfersIn: 1 }
    ],
    routes: [
      { fromRoomId: 9, fromRoomName: 'Bybit', toRoomId: 2, toRoomName: 'PokerDom', count: 5, feeUsd: 650, feeByCurrency: { USD: 650 } },
      { fromRoomId: 7, fromRoomName: 'RedStar', toRoomId: 9, toRoomName: 'Bybit', count: 2, feeUsd: 0, feeByCurrency: { EUR: 0 } },
      // удалённый рум-получатель: `toRoomId` единственное поле ответа overview, которое бывает null
      { fromRoomId: 6, fromRoomName: '1win', toRoomId: null, toRoomName: '—', count: 1, feeUsd: 0, feeByCurrency: { RUB: 0 } }
    ],
    ...overrides
  }
}

const region = (name: string) => screen.getByRole('region', { name })

/** Значение строки/карточки, подписанной слева: сосед `[data-value]` того же контейнера. */
function valueNear(scope: HTMLElement, label: string): HTMLElement {
  const labelNode = within(scope).getByText(label)
  const value = labelNode.parentElement?.querySelector('[data-value]')
  if (!value) throw new Error(`нет значения рядом с «${label}»`)
  return value as HTMLElement
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

/** Промис с ручной отдачей: тест решает, когда ответ придёт, и в каком порядке. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

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

    const historyType = screen.getAllByRole('combobox').find((el) => (el as HTMLSelectElement).options[0]?.text === 'Все типы')
    if (!historyType) throw new Error('не найден фильтр типа в истории')
    await userEvent.setup().selectOptions(historyType, 'withdraw')
    await waitFor(() => expect(mocks.transactionsList).toHaveBeenCalled())
    expect(mocks.overview).toHaveBeenCalledTimes(1)
    expect(mocks.overview).toHaveBeenCalledWith('2026-11-01', '2026-11-10')
  })
})

describe('цвета и слова', () => {
  it('выведено, комиссии и проигрыши — красным; внесено — нейтрально; выигрыши — зелёным', async () => {
    await renderWidget()
    const summary = region('Сводка за период')
    const casino = region('Казино за период')
    expect(valueNear(summary, 'Выведено').className).toContain('text-red-400')
    expect(valueNear(summary, 'Комиссии').className).toContain('text-red-400')
    expect(valueNear(casino, 'Проигрыши').className).toContain('text-red-400')
    expect(valueNear(casino, 'Выигрыши').className).toContain('text-emerald-400')
    const deposited = valueNear(summary, 'Внесено')
    expect(deposited.className).toContain('text-slate-100')
    expect(deposited.className).not.toContain('text-red-400')
    expect(deposited.className).not.toContain('text-emerald-400')
  })

  it('потери и выгоды — положительными числами со словами «потеря» и «выгода»', async () => {
    await renderWidget()
    const fx = region('Курсовая разница по переводам')
    expect(valueNear(fx, 'Потери на курсе').textContent).toBe('$2.65 потеря')
    expect(valueNear(fx, 'Потери на курсе').className).toContain('text-red-400')
    expect(valueNear(fx, 'Выгоды на курсе').textContent).toBe('$0.02 выгода')
    expect(valueNear(fx, 'Выгоды на курсе').className).toContain('text-emerald-400')
    const summary = region('Сводка за период')
    expect(summary.textContent).toContain('чистая потеря')
    expect(valueNear(summary, 'Курсовая разница').textContent).toBe('$2.63')
  })

  it('отрицательный итог курсовой разницы подписывается «чистая выгода»', async () => {
    mocks.overview.mockResolvedValue(
      overviewFixture({
        fx: { lossesUsd: 2, gainsUsd: 265, netLossUsd: -263, rows: 2, excluded: { noDestAmount: 0, sameCurrency: 0, noRate: 0 } }
      })
    )
    await renderWidget()
    const summary = region('Сводка за период')
    expect(summary.textContent).toContain('чистая выгода')
    expect(summary.textContent).not.toContain('чистая потеря')
    expect(valueNear(summary, 'Курсовая разница').className).toContain('text-emerald-400')
  })

  it('чистый внос показывает формулу расчёта', async () => {
    await renderWidget()
    expect(screen.getByText('внесено минус выведено, без комиссий и переводов')).toBeTruthy()
    expect(valueNear(region('Сводка за период'), 'Чистый внос').textContent).toBe('$81.15')
  })

  it('казино в сводке — знаковое, красным при убытке', async () => {
    await renderWidget()
    const summary = region('Сводка за период')
    expect(valueNear(summary, 'Казино').textContent).toBe('-$154.68')
    expect(valueNear(summary, 'Казино').className).toContain('text-red-400')
    expect(valueNear(summary, 'Внесено').textContent).toBe('$101.15')
    expect(valueNear(summary, 'Комиссии').textContent).toBe('$4.11')
  })
})

describe('счётчики исключений и предупреждения', () => {
  it('показывает исключённые переводы с подсказкой', async () => {
    await renderWidget()
    const fx = region('Курсовая разница по переводам')
    expect(within(fx).getByText(/2 перевода без точной суммы зачисления/)).toBeTruthy()
    expect(within(fx).getByText(/1 перевод без курса/)).toBeTruthy()
    expect(within(fx).getByText(/12 переводов между румами одной валюты/)).toBeTruthy()
    expect(within(fx).getByText('впишите сумму зачисления через «Изменить», чтобы учесть')).toBeTruthy()
  })

  it('не показывает счётчики исключений, когда они нулевые', async () => {
    mocks.overview.mockResolvedValue(
      overviewFixture({
        fx: { lossesUsd: 0, gainsUsd: 0, netLossUsd: 0, rows: 0, excluded: { noDestAmount: 0, sameCurrency: 0, noRate: 0 } }
      })
    )
    await renderWidget()
    const fx = region('Курсовая разница по переводам')
    expect(within(fx).queryByText(/без точной суммы зачисления/)).toBeNull()
    expect(within(fx).queryByText(/без курса/)).toBeNull()
    expect(within(fx).queryByText(/между румами одной валюты/)).toBeNull()
    expect(within(fx).queryByText('впишите сумму зачисления через «Изменить», чтобы учесть')).toBeNull()
  })

  it('предупреждает о неполных суммах в каждом блоке отдельно', async () => {
    mocks.overview.mockResolvedValue(
      overviewFixture({
        cash: { depositedUsd: 10_115, withdrawnUsd: 2_000, netInUsd: 8_115, missingRateRows: 3 },
        fees: { ...overviewFixture().fees, missingRateRows: 1 },
        casino: { ...overviewFixture().casino, missingRateRows: 1 }
      })
    )
    await renderWidget()
    // Предупреждения не суммируются: у кассы, комиссий и казино свои счётчики,
    // и одна строка может не иметь курса сразу и по сумме, и по комиссии.
    expect(await screen.findByText('нет курса по 3 операциям — суммы неполные')).toBeTruthy()
    expect(within(region('Комиссии за период')).getByText('нет курса по 1 комиссии — суммы неполные')).toBeTruthy()
    expect(within(region('Казино за период')).getByText('нет курса по 1 строке казино — суммы неполные')).toBeTruthy()
  })

  it('не предупреждает, когда курс есть у всех строк', async () => {
    await renderWidget()
    expect(screen.queryByText(/нет курса по/)).toBeNull()
  })

  it('null вместо числа — прочерк, а не ноль', async () => {
    const broken = structuredClone(overviewFixture()) as unknown as { cash: { netInUsd: number | null } }
    broken.cash.netInUsd = null
    mocks.overview.mockResolvedValue(broken as unknown as MoneyOverview)
    await renderWidget()
    expect(valueNear(region('Сводка за период'), 'Чистый внос').textContent).toBe('—')
    // нулей в сводке из-за отсутствующего курса быть не должно (в таблице они честные: там реальный 0)
    expect(within(region('Сводка за период')).queryByText('$0.00')).toBeNull()
  })
})

describe('казино и разбивка комиссий', () => {
  it('разводит вручную записанное и авто-списания по причинам', async () => {
    await renderWidget()
    const casino = region('Казино за период')
    expect(valueNear(casino, 'Записано вручную').textContent).toBe('-$144.84')
    expect(valueNear(casino, 'Авто-списания').textContent).toBe('-$9.84')
    expect(valueNear(casino, 'Разница курсов').textContent).toBe('-$9.84 · 2')
    expect(within(casino).getByText('ваши ручные списания, не путать с расчётной курсовой разницей')).toBeTruthy()
  })

  it('не показывает причину без строк', async () => {
    await renderWidget()
    const casino = region('Казино за период')
    expect(within(casino).queryByText('Казино')).toBeNull()
    expect(within(casino).queryByText('Прочее')).toBeNull()
  })

  it('комиссии: по типам с числом операций и по румам', async () => {
    await renderWidget()
    const fees = region('Комиссии за период')
    expect(valueNear(fees, 'Депозит').textContent).toBe('$1.51 · 2')
    expect(valueNear(fees, 'Вывод').textContent).toBe('$1.30 · 2')
    expect(valueNear(fees, 'Перевод').textContent).toBe('$1.30 · 1')
    expect(valueNear(fees, 'Bybit').textContent).toBe('$4.10 · 3')
    expect(valueNear(fees, 'PokerDom').textContent).toBe('$0.01 · 1')
  })
})

describe('таблицы', () => {
  it('по румам: имя в цвете рума, все колонки, курсовая разница получателя', async () => {
    await renderWidget()
    const table = screen.getByRole('table', { name: 'Куда уходят деньги по румам' })
    for (const column of ['Внесено', 'Выведено', 'Комиссии', 'Казино', 'Курс. разница', 'Переводы']) {
      expect(within(table).getByText(column)).toBeTruthy()
    }
    expect(within(table).getByText('PokerDom').getAttribute('style')).toContain('rgb(110, 231, 183)')
    expect(within(table).getByText('-$154.68')).toBeTruthy()
    expect(within(table).getByText('-$0.02')).toBeTruthy()
    expect(within(table).getByText('↑6 ↓3')).toBeTruthy()
  })

  it('маршруты: только число переводов и комиссии, без сумм переводов', async () => {
    await renderWidget()
    const table = screen.getByRole('table', { name: 'Маршруты переводов' })
    for (const column of ['Откуда', 'Куда', 'Переводов', 'Комиссии']) {
      expect(within(table).getByText(column)).toBeTruthy()
    }
    expect(within(table).queryByText(/Переведено|Сумма переводов|Итого переводов/)).toBeNull()
    const rows = within(table).getAllByRole('row')
    const bybitRow = rows.find((r) => within(r).queryByText('PokerDom')) as HTMLElement
    expect(within(bybitRow).getByText('5')).toBeTruthy()
    expect(within(bybitRow).getByText('$6.50')).toBeTruthy()
    const redstarRow = rows.find((r) => within(r).queryByText('RedStar')) as HTMLElement
    expect(within(redstarRow).getByText('2')).toBeTruthy()
    expect(within(redstarRow).getByText('—')).toBeTruthy()
    expect(within(redstarRow).queryByText(/€/)).toBeNull()
    // маршрут с удалённым получателем: null показан прочерком, а не нулём и не пустотой
    const goneRow = rows.find((r) => within(r).queryByText('1win')) as HTMLElement
    expect(within(goneRow).getAllByText('—').length).toBe(2)
    expect(within(goneRow).queryByText('$0.00')).toBeNull()
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
    expect(await screen.findByText('$4.11')).toBeTruthy()
  })

  it('ошибка с кнопкой «Повторить»', async () => {
    mocks.overview.mockRejectedValueOnce(new Error('сервер недоступен'))
    render(<SpendingWidget rooms={rooms} />)
    expect(await screen.findByText('сервер недоступен')).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('$4.11')).toBeTruthy()
  })

  it('пустой период', async () => {
    mocks.overview.mockResolvedValue(emptyMoneyOverview())
    await renderWidget()
    expect(await screen.findByText('За период операций нет')).toBeTruthy()
    expect(screen.queryByText(/\$/)).toBeNull()
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
    await waitFor(() => expect(valueNear(region('Сводка за период'), 'Внесено').textContent).toBe('$555.00'))

    slow.resolve(overviewFixture())
    await new Promise((r) => setTimeout(r, 0))
    expect(valueNear(region('Сводка за период'), 'Внесено').textContent).toBe('$555.00')
    expect(screen.queryByText('$101.15')).toBeNull()
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
    await waitFor(() => expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('9'))
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
    writeoff: false,
    writeoffReason: null
  }
}
