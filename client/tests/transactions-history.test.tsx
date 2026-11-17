import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TransactionsPage from '../src/pages/Transactions'
import { emptyMoneyOverview } from './setup'
import type { Transaction, TransactionTotals } from '../src/lib/types'

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

// Дата зафиксирована, как в тесте виджета: страница подставляет её в форму операции.
const TODAY = new Date(2026, 10, 10, 12, 0, 0)

const bybit = {
  id: 9,
  name: 'Bybit',
  cashCurrency: 'USD',
  tournamentCurrency: 'USD',
  rateSource: null,
  color: '#f1f5f9',
  isWallet: true,
  createdAt: '2026-09-01 00:00:00'
}
const pokerdom = {
  id: 2,
  name: 'PokerDom',
  cashCurrency: 'RUB',
  tournamentCurrency: 'RUB',
  rateSource: 'pokerdom',
  color: '#6ee7b7',
  isWallet: false,
  createdAt: '2026-09-01 00:00:00'
}

function totalsFixture(overrides: Partial<TransactionTotals> = {}): TransactionTotals {
  const base = emptyTransactionTotals()
  return { ...base, ...overrides }
}

/** Полное зеркало серверного `totals`; боевые числа из проверки живого ответа. */
function emptyTransactionTotals(): TransactionTotals {
  return {
    feeUsd: 0,
    feeByCurrency: {},
    missingRateRows: 0,
    flowUsd: 0,
    flowScope: 'all_without_transfers',
    flowCountedRows: 0,
    flowMissingRateRows: 0,
    transfers: { count: 0, feeUsd: 0 },
    fxNetLossUsd: 0,
    costUsd: 0,
    fxNotCountedTransfers: 0
  }
}

function tx(overrides: Partial<Transaction> & { id: number }): Transaction {
  const { id, ...rest } = overrides
  return {
    roomId: bybit.id,
    roomName: bybit.name,
    type: 'deposit',
    amount: 10_000,
    fee: 0,
    currency: 'USD',
    direction: 'in',
    counterpart: null,
    destinationRoomId: null,
    destinationRoomName: null,
    destAmount: null,
    destCurrency: null,
    date: '2026-11-05',
    comment: null,
    createdAt: '2026-11-05 10:00:00',
    amountUsd: 10_000,
    feeUsd: 0,
    fxExpectedDest: null,
    fxDiffUsd: null,
    costUsd: 0,
    writeoff: false,
    writeoffReason: null,
    ...rest,
    id
  }
}

/** Строка перевода с посчитанной курсовой разницей. */
function transfer(id: number, fxDiffUsd: number | null, feeUsd: number | null, extra: Partial<Transaction> = {}): Transaction {
  return tx({
    id,
    type: 'transfer',
    direction: 'out',
    destinationRoomId: pokerdom.id,
    destinationRoomName: pokerdom.name,
    fxDiffUsd,
    feeUsd,
    ...extra
  })
}

async function renderPage(totals: TransactionTotals, rows: Transaction[] = []) {
  mocks.transactionsList.mockResolvedValue({ transactions: rows, discrepancies: [], totals })
  render(<TransactionsPage />)
  await screen.findByRole('heading', { name: 'История операций' })
  await waitFor(() => expect(mocks.transactionsList).toHaveBeenCalled())
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  mocks.roomsList.mockReset().mockResolvedValue([bybit, pokerdom])
  mocks.transactionsList.mockReset()
  mocks.overview.mockReset().mockResolvedValue(emptyMoneyOverview())
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

describe('«Суммарно по фильтру» берётся с сервера', () => {
  it('показывается totals.flowUsd, а не сумма строк списка', async () => {
    // строки в сумме дают $80.00, сервер говорит $576.36
    const rows = [tx({ id: 1, amountUsd: 5_000 }), tx({ id: 2, amountUsd: 3_000 })]
    await renderPage(totalsFixture({ flowUsd: 57_636, flowCountedRows: 64 }), rows)
    const line = await screen.findByText(/Суммарно по фильтру/)
    expect(line.textContent).toContain('$576.36')
    expect(line.textContent).not.toContain('$80.00')
    expect(screen.queryByText('+$80.00')).toBeNull()
  })

  it('режим all_without_transfers: пояснение только во всплывающей подсказке', async () => {
    await renderPage(totalsFixture({ flowUsd: 57_636, flowScope: 'all_without_transfers' }))
    const hinted = screen.getByTitle('Без переводов: перевод это перекладывание денег между своими румами')
    expect(hinted.textContent).toContain('Суммарно по фильтру')
    expect(hinted.textContent).not.toContain('Без переводов')
  })

  it('режим type: сумма есть, пояснения про переводы нет', async () => {
    await renderPage(totalsFixture({ flowUsd: 89_228, flowScope: 'type' }))
    expect(screen.getByText(/Суммарно по фильтру/).textContent).toContain('$892.28')
    expect(screen.queryByTitle('Без переводов: перевод это перекладывание денег между своими румами')).toBeNull()
  })

  it('режим none: суммы нет, есть число переводов и их комиссии', async () => {
    await renderPage(
      totalsFixture({
        flowUsd: null,
        flowScope: 'none',
        transfers: { count: 17, feeUsd: 2_165 },
        feeUsd: 2_165,
        fxNetLossUsd: 477,
        costUsd: 2_642
      })
    )
    expect(screen.queryByText(/Суммарно по фильтру/)).toBeNull()
    expect(screen.getByText(/Переводов: 17/)).toBeTruthy()
    // метка и значение разнесены (значение окрашено), поэтому проверяем обе части строки
    expect(screen.getByText(/Комиссии:/).textContent).toContain('Комиссии:')
    const cost = screen.getByText('$26.42')
    expect(cost.className).toContain('text-red-400')
    // строка «Комиссии по фильтру» в этом режиме не дублируется
    expect(screen.queryByText(/Комиссии по фильтру/)).toBeNull()
  })

  it('null-курс: прочерк и янтарная подпись о числе строк', async () => {
    await renderPage(totalsFixture({ flowUsd: null, flowMissingRateRows: 3 }))
    const line = await screen.findByText(/Суммарно по фильтру/)
    expect(line.textContent).toContain('—')
    expect(line.textContent).not.toContain('$0.00')
    expect(screen.getByText('нет курса по 3 строкам')).toBeTruthy()
  })
})

describe('«Комиссии по фильтру» = комиссии плюс курс', () => {
  it('итог из costUsd, красным при положительном, с разбивкой в подсказке', async () => {
    await renderPage(
      totalsFixture({ feeUsd: 2_295, fxNetLossUsd: 477, costUsd: 2_772, flowUsd: 57_636 })
    )
    const line = await screen.findByText(/Комиссии по фильтру/)
    expect(line.textContent).toContain('$27.72')
    const value = within(line).getByText('$27.72')
    expect(value.className).toContain('text-red-400')
    expect(screen.getByTitle('прямые $22.95 · на курсе $4.77')).toBeTruthy()
  })

  it('нулевой итог — белый', async () => {
    await renderPage(totalsFixture({ costUsd: 0, feeUsd: 0, fxNetLossUsd: 0 }))
    const line = await screen.findByText(/Комиссии по фильтру/)
    const zero = within(line).getByText('$0.00')
    expect(zero.className).toContain('text-slate-100')
    expect(zero.className).not.toContain('text-red')
  })

  it('выигрыш на курсе: зелёный итог и подсказка «на курсе выгода»', async () => {
    await renderPage(totalsFixture({ feeUsd: 245, fxNetLossUsd: -477, costUsd: -232 }))
    const line = await screen.findByText(/Комиссии по фильтру/)
    expect(within(line).getByText('-$2.32').className).toContain('text-emerald-400')
    expect(screen.getByTitle('прямые $2.45 · на курсе выгода $4.77')).toBeTruthy()
  })

  it('«курс не учтён у N переводов» — только при счётчике больше нуля, со склонением', async () => {
    await renderPage(totalsFixture({ fxNotCountedTransfers: 2 }))
    expect(await screen.findByText('курс не учтён у 2 переводов')).toBeTruthy()
  })

  it('склонение на одного перевода', async () => {
    await renderPage(totalsFixture({ fxNotCountedTransfers: 1 }))
    expect(await screen.findByText('курс не учтён у 1 перевода')).toBeTruthy()
  })

  it('при нуле строки нет', async () => {
    await renderPage(totalsFixture({ fxNotCountedTransfers: 0 }))
    await screen.findByText(/Комиссии по фильтру/)
    expect(screen.queryByText(/курс не учтён/)).toBeNull()
  })

  it('комиссия без курса: янтарная строка', async () => {
    await renderPage(totalsFixture({ missingRateRows: 1, costUsd: 130, feeUsd: 130 }))
    expect(await screen.findByText('нет курса по 1 строке')).toBeTruthy()
  })
})

describe('столбец «Комиссия»: курсовая разница перевода', () => {
  it('положительная разница — красная подпись «курс $2.42»', async () => {
    await renderPage(emptyTransactionTotals(), [transfer(11, 242, 130, { fee: 130 })])
    const note = await screen.findByText('курс $2.42')
    expect(note.className).toContain('text-red-400')
  })

  it('отрицательная разница — зелёная подпись «курс −$0.02»', async () => {
    await renderPage(emptyTransactionTotals(), [transfer(12, -2, 130, { fee: 130 })])
    const note = await screen.findByText('курс −$0.02')
    expect(note.className).toContain('text-emerald-400')
  })

  it('кросс-валютный перевод без разницы: серая подпись и подсказка про «Изменить»', async () => {
    await renderPage(
      emptyTransactionTotals(),
      [transfer(13, null, null, { destCurrency: 'RUB', fee: 100, feeUsd: null, destinationRoomId: pokerdom.id })]
    )
    const note = await screen.findByText('курс не учтён')
    expect(note.className).toContain('text-slate-500')
    expect(note.getAttribute('title')).toBe('впишите сумму зачисления через «Изменить»')
  })

  it('перевод одной валюты — ничего не добавляется', async () => {
    await renderPage(emptyTransactionTotals(), [
      transfer(14, null, 0, { currency: 'USD', destCurrency: 'USD', destinationRoomId: pokerdom.id })
    ])
    await screen.findByText(/Суммарно по фильтру/)
    expect(screen.queryByText(/курс не учтён/)).toBeNull()
    expect(screen.queryByText(/курс \$|курс −/)).toBeNull()
  })

  it('не переводы — подписи про курс нет', async () => {
    await renderPage(emptyTransactionTotals(), [
      tx({ id: 15, type: 'deposit' }),
      tx({ id: 16, type: 'withdraw', direction: 'out', fee: 130, feeUsd: 130 }),
      tx({ id: 17, type: 'casino', amount: -14_484, amountUsd: -14_484 })
    ])
    await screen.findByText(/Суммарно по фильтру/)
    expect(screen.queryByText(/курс не учтён/)).toBeNull()
    expect(screen.queryByText(/курс \$|курс −/)).toBeNull()
  })

  it('подпись есть и при нулевой комиссии («—» в столбце)', async () => {
    await renderPage(emptyTransactionTotals(), [transfer(18, 242, 0, { fee: 0 })])
    const row = (await screen.findByText('курс $2.42')).closest('tr') as HTMLElement
    const cells = row.querySelectorAll('td')
    const feeCell = cells[5] as HTMLElement
    // и прочерк вместо нулевой комиссии, и подпись про курс — в одной клетке
    expect(feeCell.textContent).toContain('—')
    expect(feeCell.textContent).toContain('курс $2.42')
  })

  it('сама комиссия в валюте операции остаётся как была', async () => {
    await renderPage(emptyTransactionTotals(), [transfer(19, 242, 130, { fee: 130, destinationRoomId: bybit.id })])
    const row = (await screen.findByText('курс $2.42')).closest('tr') as HTMLElement
    expect(within(row).getByText('$1.30')).toBeTruthy()
  })
})

describe('фильтры истории по-прежнему обновляют итоги', () => {
  it('смена типа перезапрашивает список и перерисовывает итоги сервера', async () => {
    await renderPage(totalsFixture({ flowUsd: 57_636, costUsd: 2_772 }), [tx({ id: 20 })])
    mocks.transactionsList.mockResolvedValue({
      transactions: [],
      discrepancies: [],
      totals: totalsFixture({ flowUsd: null, flowScope: 'none', flowMissingRateRows: 0, transfers: { count: 17, feeUsd: 2_165 }, costUsd: 2_642 })
    })
    const historyType = screen.getAllByRole('combobox').find((el) => (el as HTMLSelectElement).options[0]?.text === 'Все типы')
    if (!historyType) throw new Error('не найден фильтр типа')
    await userEvent.setup().selectOptions(historyType, 'transfer')
    await waitFor(() => expect(mocks.transactionsList).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'transfer' })))
    await waitFor(() => expect(screen.queryByText(/Суммарно по фильтру/)).toBeNull())
    expect(await screen.findByText(/Переводов: 17/)).toBeTruthy()
  })

  it('фильтр умеет выбрать «Бонус»', async () => {
    await renderPage(emptyTransactionTotals(), [])
    const historyType = screen.getAllByRole('combobox').find((el) => (el as HTMLSelectElement).options[0]?.text === 'Все типы')
    if (!historyType) throw new Error('не найден фильтр типа')
    const user = userEvent.setup()
    await user.selectOptions(historyType, 'bonus')
    await waitFor(() => expect(mocks.transactionsList).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'bonus' })))
  })
})

describe('строка «Бонус» в истории', () => {
  function cells(row: HTMLElement): HTMLElement[] {
    return Array.from(row.querySelectorAll('td')) as HTMLElement[]
  }

  /** «Бонус» живёт и в option'ах селектов, и в бейдже строки: нужен именно бейдж. */
  async function bonusRow(): Promise<HTMLElement> {
    const badge = (await screen.findAllByText('Бонус')).find((el) => el.tagName === 'SPAN')
    const row = badge?.closest('tr')
    if (!row) throw new Error('строка бонуса не найдена')
    return row as HTMLElement
  }

  it('риcует бейдж типа, направление по знаку и зелёный плюс', async () => {
    await renderPage(emptyTransactionTotals(), [tx({ id: 30, type: 'bonus', amount: 5_000, amountUsd: 5_000 })])
    const row = await bonusRow()
    const [date, room, type, direction, amount, fee] = cells(row)
    expect(date?.textContent).toBe('2026-11-05')
    expect(room?.textContent).toBe('Bybit')
    // Тип — бейджем, как «Казино»: рейкбек не должен теряться в списке.
    expect(type?.textContent).toBe('Бонус')
    expect(type?.querySelector('span')?.className).toContain('rounded-full')
    // Направление — «Начисление», а не «В рум»: это не депозит.
    expect(direction?.textContent).toBe('Начисление')
    expect(amount?.textContent).toContain('+$50.00')
    expect(amount?.querySelector('span')?.className).toContain('text-emerald-400')
    // комиссии у бонуса нет
    expect(fee?.textContent).toContain('—')
  })

  it('отрицательный бонус — «Удержание» красным минусом', async () => {
    await renderPage(emptyTransactionTotals(), [tx({ id: 31, type: 'bonus', amount: -1_000, amountUsd: -1_000, direction: 'out' })])
    const row = await bonusRow()
    const [, , , direction, amount] = cells(row)
    expect(direction?.textContent).toBe('Удержание')
    expect(amount?.textContent).toContain('-$10.00')
    expect(amount?.querySelector('span')?.className).toContain('text-red-400')
  })

  it('казино остаётся «Выигрыш»/«Проигрыш»: общий рендер не съел его подписи', async () => {
    await renderPage(emptyTransactionTotals(), [
      tx({ id: 32, type: 'casino', amount: 2_000, amountUsd: 2_000 }),
      tx({ id: 33, type: 'casino', amount: -3_000, amountUsd: -3_000, direction: 'out' })
    ])
    const win = (await screen.findByText('Выигрыш')).closest('tr') as HTMLElement
    const loss = screen.getByText('Проигрыш').closest('tr') as HTMLElement
    expect(cells(win)[2]?.textContent).toBe('Казино')
    expect(cells(loss)[2]?.textContent).toBe('Казино')
  })
})

describe('форма операции: тип «Бонус»', () => {
  const amountInput = () => screen.getByPlaceholderText('100.00 или -100.00') as HTMLInputElement
  const feeInput = () => screen.getByPlaceholderText('0.00') as HTMLInputElement

  async function openFormWithBonus() {
    await renderPage(emptyTransactionTotals(), [])
    const user = userEvent.setup()
    const typeSelect = screen
      .getAllByRole('combobox')
      .find((el) => Array.from((el as HTMLSelectElement).options).some((o) => o.value === 'bonus'))
    if (!typeSelect) throw new Error('в форме нет типа «Бонус»')
    await user.selectOptions(typeSelect, 'bonus')
    // рум по умолчанию уже выбран (первый из списка); подсказка знака — признак режима
    expect(await screen.findByText(/По знаку суммы/)).toBeTruthy()
    return user
  }

  it('комиссия заблокирована, направление читается по знаку суммы', async () => {
    const user = await openFormWithBonus()
    expect(feeInput().disabled).toBe(true)
    // поле суммы принимает минус: это знаковый тип
    await user.type(amountInput(), '-12.50')
    expect(amountInput().value).toBe('-12.50')
    expect(amountInput()).toHaveProperty('inputMode', 'text')
  })

  it('шлёт знак суммы и направление из знака, комиссия — нулевая', async () => {
    const user = await openFormWithBonus()
    await user.type(amountInput(), '-12.50')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalled())
    const payload = mocks.create.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload).toMatchObject({ type: 'bonus', amount: -1250, fee: 0, direction: 'out' })
  })

  it('нулевую сумму бонуса не отправляет', async () => {
    const user = await openFormWithBonus()
    await user.clear(amountInput())
    await user.type(amountInput(), '0')
    await user.click(screen.getByRole('button', { name: 'Добавить' }))
    expect(await screen.findByText(/Сумма бонуса должна быть ненулевой/)).toBeTruthy()
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
