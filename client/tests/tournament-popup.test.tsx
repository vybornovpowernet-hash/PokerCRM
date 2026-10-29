import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TournamentPopup } from '../src/components/TournamentPopup'
import type { Room, TournamentRow } from '../src/lib/types'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  preview: vi.fn(),
  save: vi.fn(),
  adjustBalance: vi.fn(),
  importGg: vi.fn(),
  importPokerDom: vi.fn(),
  deleteImport: vi.fn(),
  revokeDiscrepancyAck: vi.fn()
}))

vi.mock('../src/lib/api', () => ({
  api: {
    tournaments: {
      list: mocks.list,
      preview: mocks.preview,
      save: mocks.save,
      adjustBalance: mocks.adjustBalance,
      importGg: mocks.importGg,
      importPokerDom: mocks.importPokerDom,
      deleteImport: mocks.deleteImport,
      revokeDiscrepancyAck: mocks.revokeDiscrepancyAck
    }
  }
}))

const pokerdom: Room = {
  id: 1,
  name: 'PokerDom',
  cashCurrency: 'RUB',
  tournamentCurrency: 'RUB',
  rateSource: 'pokerdom',
  color: '#6ee7b7',
  isWallet: false,
  createdAt: '2026-09-18 00:00:00'
}

const gg: Room = {
  id: 2,
  name: 'GG Poker',
  cashCurrency: 'USD',
  tournamentCurrency: 'USD',
  rateSource: 'er-api',
  color: '#fde68a',
  isWallet: false,
  createdAt: '2026-09-18 00:00:00'
}

const hashed = (over: Partial<TournamentRow>): TournamentRow => ({
  id: 1,
  roomId: 1,
  roomName: 'PokerDom',
  date: '2026-09-16',
  buyin: 500_00,
  result: 128_805,
  currency: 'RUB',
  name: 'Супер Прогрессивный Нокаут 30 000 р.',
  rank: 13,
  entrants: null,
  tournamentId: 111,
  ...over
})

const renderPopup = (room: Room, date = '2026-09-16') =>
  render(<TournamentPopup open room={room} date={date} onClose={() => undefined} onChanged={() => undefined} />)

const shownForm = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset()
})

describe('TournamentPopup — PokerDom text-imported tournaments', () => {
  it('loads hashed text tournaments of a PokerDom day into editable form rows', async () => {
    mocks.list.mockResolvedValue([hashed({}), hashed({ buyin: 250_00, result: 50_00, tournamentId: 222 })])
    renderPopup(pokerdom)

    await waitFor(() => expect(shownForm('Бай-ин строки 1').value).toBe('500.00'))
    expect(shownForm('Результат строки 1').value).toBe('1288.05')
    expect(shownForm('Бай-ин строки 2').value).toBe('250.00')
    expect(shownForm('Результат строки 2').value).toBe('50.00')
    // the empty trailing row is still there for adding more
    expect(shownForm('Бай-ин строки 3').value).toBe('')
    // no read-only import table for the converted rows
    expect(screen.queryByText('Супер Прогрессивный Нокаут 30 000 р.')).toBeNull()
  })

  it('saves the converted rows as lines and releases their ids', async () => {
    mocks.list.mockResolvedValue([hashed({}), hashed({ buyin: 250_00, result: 50_00, tournamentId: 222 })])
    mocks.save.mockResolvedValue({ rows: [], reconcile: null, days: [] })
    const user = userEvent.setup()
    renderPopup(pokerdom)

    await waitFor(() => expect(shownForm('Бай-ин строки 1').value).toBe('500.00'))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(mocks.save).toHaveBeenCalledWith(
      1,
      '2026-09-16',
      [
        { buyin: 50000, result: 128805, currency: 'RUB' },
        { buyin: 25000, result: 5000, currency: 'RUB' }
      ],
      [],
      [111, 222]
    )
  })

  it('skips a re-parsed tournament already loaded as a row even when its id changed (32→53-bit)', async () => {
    mocks.list.mockResolvedValue([hashed({ tournamentId: 111, name: 'Same MTT' })])
    mocks.importPokerDom.mockResolvedValue({
      tournaments: [
        // same numbers, but the id algorithm changed: legacy id 111 → a wide id
        { tournamentId: 900111, name: 'Same MTT', date: '2026-09-16', buyin: 500_00, result: 128_805, rank: 13, entrants: null, currency: 'RUB' },
        { tournamentId: 222, name: 'New MTT', date: '2026-09-16', buyin: 250_00, result: 0, rank: null, entrants: null, currency: 'RUB' }
      ],
      successfullyParsed: 2,
      failures: [],
      totalSources: 2
    })
    const user = userEvent.setup()
    renderPopup(pokerdom)

    await waitFor(() => expect(shownForm('Бай-ин строки 1').value).toBe('500.00'))
    await user.type(screen.getByPlaceholderText(/Вставьте текст отчёта PokerDom/), 'ignored')
    await user.click(screen.getByRole('button', { name: 'Вставить и разобрать' }))

    expect(await screen.findByText('New MTT')).toBeTruthy()
    expect(screen.queryByText('Same MTT')).toBeNull()
    expect(screen.getAllByText('2026-09-16')).toHaveLength(1)
  })

  it('skips a re-parsed tournament whose id still matches a loaded row', async () => {
    mocks.list.mockResolvedValue([hashed({ tournamentId: 111, name: 'Same MTT' })])
    mocks.importPokerDom.mockResolvedValue({
      tournaments: [
        { tournamentId: 111, name: 'Same MTT', date: '2026-09-16', buyin: 500_00, result: 128_805, rank: 13, entrants: null, currency: 'RUB' }
      ],
      successfullyParsed: 1,
      failures: [],
      totalSources: 1
    })
    const user = userEvent.setup()
    renderPopup(pokerdom)

    await waitFor(() => expect(shownForm('Бай-ин строки 1').value).toBe('500.00'))
    await user.type(screen.getByPlaceholderText(/Вставьте текст отчёта PokerDom/), 'ignored')
    await user.click(screen.getByRole('button', { name: 'Вставить и разобрать' }))

    await waitFor(() => expect(mocks.importPokerDom).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Same MTT')).toBeNull()
  })
})

describe('TournamentPopup — GG multi-archive upload', () => {
  const ggResult = (id: number, name: string, over: Partial<TournamentRow> = {}): TournamentRow =>
    hashed({ roomId: 2, roomName: 'GG Poker', currency: 'USD', name, tournamentId: id, ...over })

  it('imports several selected archives sequentially and merges duplicates', async () => {
    mocks.list.mockResolvedValue([])
    mocks.importGg
      .mockResolvedValueOnce({
        tournaments: [ggResult(1, 'Daily Turbo 5.50')],
        successfullyParsed: 1,
        failures: [],
        totalSources: 1
      })
      .mockResolvedValueOnce({
        tournaments: [ggResult(1, 'Daily Turbo 5.50'), ggResult(2, 'Nightly Turbo 11', { buyin: 11_00, result: 0 })],
        successfullyParsed: 1,
        failures: [],
        totalSources: 1
      })
      .mockResolvedValueOnce({
        tournaments: [ggResult(3, 'Sunday Special 22', { buyin: 22_00, result: 0 })],
        successfullyParsed: 1,
        failures: [],
        totalSources: 1
      })
    const user = userEvent.setup()
    renderPopup(gg)

    const input = screen.getByLabelText('Выбрать архивы') as HTMLInputElement
    await user.upload(input, [
      new File(['a'], 'a.zip', { type: 'application/zip' }),
      new File(['b'], 'b.zip', { type: 'application/zip' }),
      new File(['c'], 'c.zip', { type: 'application/zip' })
    ])

    await waitFor(() => expect(mocks.importGg).toHaveBeenCalledTimes(3))
    expect(mocks.importGg.mock.calls.map((c) => (c[1] as File).name)).toEqual(['a.zip', 'b.zip', 'c.zip'])

    expect(await screen.findByText('Nightly Turbo 11')).toBeTruthy()
    expect(screen.getByText('Sunday Special 22')).toBeTruthy()
    expect(screen.getAllByText('Daily Turbo 5.50')).toHaveLength(1)
    expect(screen.getByText(/Разобрано турниров: 3 из 3 файлов/)).toBeTruthy()
  })

  it('keeps successfully-imported archives and reports failed ones', async () => {
    mocks.list.mockResolvedValue([])
    mocks.importGg
      .mockResolvedValueOnce({
        tournaments: [ggResult(7, 'Good MTT', { buyin: 10_00, result: 25_00, rank: 10 })],
        successfullyParsed: 1,
        failures: [],
        totalSources: 1
      })
      .mockRejectedValueOnce(new Error('Ошибка 501: нет парсера'))
    const user = userEvent.setup()
    renderPopup(gg)

    const input = screen.getByLabelText('Выбрать архивы') as HTMLInputElement
    await user.upload(input, [new File(['a'], 'a.zip', { type: 'application/zip' }), new File(['b'], 'b.zip', { type: 'application/zip' })])

    await waitFor(() => expect(mocks.importGg).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Good MTT')).toBeTruthy()
    expect(screen.getByText(/b\.zip: Ошибка 501/)).toBeTruthy()
  })

  it('still allows saving the parsed rows when part of an archive failed', async () => {
    mocks.list.mockResolvedValue([])
    mocks.importGg.mockResolvedValueOnce({
      tournaments: [ggResult(9, 'Partial MTT', { buyin: 10_00, result: 20_00 })],
      successfullyParsed: 1,
      failures: [{ source: 'broken.txt', error: 'не найдена строка "Buy-in:"' }],
      totalSources: 2
    })
    mocks.save.mockResolvedValue({ rows: [], reconcile: null, days: [] })
    const user = userEvent.setup()
    renderPopup(gg)

    const input = screen.getByLabelText('Выбрать архивы') as HTMLInputElement
    await user.upload(input, [new File(['a'], 'partial.zip', { type: 'application/zip' })])

    expect(await screen.findByText('Partial MTT')).toBeTruthy()
    expect(screen.getByText(/Не удалось разобрать часть отчётов/)).toBeTruthy()
    // the stop-cock must not fire: what was recognised is savable
    const save = screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    await user.click(save)
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
  })

  it('blocks saving only when the archive has no report files at all', async () => {
    mocks.list.mockResolvedValue([])
    mocks.importGg.mockResolvedValueOnce({ tournaments: [], successfullyParsed: 0, failures: [], totalSources: 0 })
    const user = userEvent.setup()
    renderPopup(gg)

    const input = screen.getByLabelText('Выбрать архивы') as HTMLInputElement
    await user.upload(input, [new File(['a'], 'empty.zip', { type: 'application/zip' })])

    expect(await screen.findByText(/нет файлов отчётов/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('TournamentPopup — списание остатка с причиной', () => {
  const flagged = {
    date: '2026-09-16',
    roomId: 1,
    roomName: 'PokerDom',
    sessionProfitUsd: 200_00,
    tournamentProfitUsd: 0,
    casinoUsd: 0,
    remainderUsd: 200_00,
    discrepancyPct: 1,
    flagged: true,
    acknowledged: false,
    blank: null
  }
  const closed = { ...flagged, remainderUsd: 0, discrepancyPct: 0, flagged: false, casinoUsd: 200_00 }

  it('saves the import and closes the day in one request, carrying the chosen reason', async () => {
    mocks.list.mockResolvedValue([])
    mocks.preview.mockResolvedValue({ reconcile: flagged, wouldReanchor: null })
    mocks.save.mockResolvedValue({ rows: [], reconcile: closed, days: [closed] })
    const user = userEvent.setup()
    renderPopup(pokerdom)

    await user.click(screen.getByRole('button', { name: 'Проверить' }))
    expect(await screen.findByText(/Расхождение 100%/)).toBeTruthy()

    // the reason is a deliberate choice, not a hidden default
    await user.click(screen.getByRole('button', { name: 'Списать остаток…' }))
    await user.click(screen.getByRole('menuitem', { name: 'Казино' }))

    // one request carries the whole action — the write-off reason rides with the save
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(mocks.save).toHaveBeenCalledWith(1, '2026-09-16', [], [], [], 'casino')
    // no second round-trip could leave the day saved-but-open
    expect(mocks.adjustBalance).not.toHaveBeenCalled()
    // the closed day the server answered with is shown as is
    expect(await screen.findByText('Расхождение в пределах 5% — сходится.')).toBeTruthy()
  })

  it('passes a non-casino reason through to the server', async () => {
    mocks.list.mockResolvedValue([])
    mocks.preview.mockResolvedValue({ reconcile: flagged, wouldReanchor: null })
    mocks.save.mockResolvedValue({ rows: [], reconcile: closed, days: [closed] })
    const user = userEvent.setup()
    renderPopup(pokerdom)

    await user.click(screen.getByRole('button', { name: 'Проверить' }))
    await screen.findByText(/Расхождение 100%/)
    await user.click(screen.getByRole('button', { name: 'Списать остаток…' }))
    await user.click(screen.getByRole('menuitem', { name: 'Разница курсов' }))

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(mocks.save).toHaveBeenCalledWith(1, '2026-09-16', [], [], [], 'fx')
  })

  it('saves without a write-off on a plain «Сохранить»', async () => {
    mocks.list.mockResolvedValue([])
    mocks.save.mockResolvedValue({ rows: [], reconcile: null, days: [] })
    const user = userEvent.setup()
    renderPopup(pokerdom)

    await waitFor(() => expect(mocks.list).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(mocks.save).toHaveBeenCalledWith(1, '2026-09-16', [], [], [])
  })

  it('explains why there is nothing to compare when the balance is only interpolated', async () => {
    // the server withholds the comparison on a day whose balance is 'auto' —
    // the popup must not dress that up as a green "сходится"
    const auto = {
      date: '2026-09-16',
      roomId: 1,
      roomName: 'PokerDom',
      sessionProfitUsd: 0,
      tournamentProfitUsd: -100_00,
      casinoUsd: 0,
      remainderUsd: null,
      discrepancyPct: null,
      flagged: false,
      blank: 'нет ручного баланса за день — сверить не с чем, запиши его в «Балансах»'
    }
    mocks.list.mockResolvedValue([])
    mocks.preview.mockResolvedValue({ reconcile: auto, wouldReanchor: null })
    const user = userEvent.setup()
    renderPopup(pokerdom)

    await user.click(screen.getByRole('button', { name: 'Проверить' }))

    expect(await screen.findByText(auto.blank)).toBeTruthy()
    expect(screen.queryByText('Расхождение в пределах 5% — сходится.')).toBeNull()
    // nothing to write off or adjust — the fix is recording the balance itself
    expect(screen.queryByRole('button', { name: 'Списать остаток…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Поправить баланс' })).toBeNull()
  })

  it('shows an accepted day without offering a write-off, and can hand it back', async () => {
    const accepted = { ...flagged, flagged: false, acknowledged: true }
    const reflagged = { ...flagged, acknowledged: false }
    mocks.list.mockResolvedValue([])
    mocks.preview.mockResolvedValueOnce({ reconcile: accepted, wouldReanchor: null }).mockResolvedValueOnce({ reconcile: reflagged, wouldReanchor: null })
    mocks.revokeDiscrepancyAck.mockResolvedValue(reflagged)
    const user = userEvent.setup()
    renderPopup(pokerdom)

    await user.click(screen.getByRole('button', { name: 'Проверить' }))
    expect(await screen.findByText(/Расхождение принято/)).toBeTruthy()
    // accepting is not spending: no casino write-off is offered on such a day
    expect(screen.queryByRole('button', { name: 'Списать остаток…' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Вернуть расхождение' }))
    await waitFor(() => expect(mocks.revokeDiscrepancyAck).toHaveBeenCalledWith(1, '2026-09-16'))
    // the re-computed state is shown as is: the flag is back with the write-off choice
    expect(await screen.findByText(/Расхождение 100%/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Списать остаток…' })).toBeTruthy()
  })
})

describe('TournamentPopup — баланс-реанкор в превью', () => {
  it('показывает сверку на день привязки баланса вместо фантомного расхождения', async () => {
    // баланс записан «сегодня» (2026-09-16), а турниры отчёта — на 2026-09-15:
    // сервер предсказывает реанкор {from: 09-16, to: 09-15} и сверяет целевой день
    const converged = {
      date: '2026-09-15',
      roomId: 1,
      roomName: 'PokerDom',
      sessionProfitUsd: -150,
      tournamentProfitUsd: -150,
      casinoUsd: 0,
      remainderUsd: 0,
      discrepancyPct: 0,
      flagged: false,
      blank: null
    }
    mocks.list.mockResolvedValue([])
    mocks.preview.mockResolvedValue({ reconcile: converged, wouldReanchor: { from: '2026-09-16', to: '2026-09-15' } })
    const user = userEvent.setup()
    renderPopup(pokerdom, '2026-09-16')

    await user.click(screen.getByRole('button', { name: 'Проверить' }))

    // нейтральная заметка о переносе вместо янтарной панели «Расхождение 100%»
    expect(await screen.findByText(/Баланс 2026-09-16 будет привязан к 2026-09-15 при сохранении/)).toBeTruthy()
    expect(screen.queryByText(/Расхождение \d+%/)).toBeNull()
    expect(screen.getByText('Расхождение в пределах 5% — сходится.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Списать остаток…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Поправить баланс' })).toBeNull()
  })
})