import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SessionsPage from '../src/pages/Sessions'
import type { ReconcileFlag, Room, SessionDay } from '../src/lib/types'

const mocks = vi.hoisted(() => ({
  roomsList: vi.fn(),
  sessionsList: vi.fn(),
  reconcileSummary: vi.fn()
}))

vi.mock('../src/lib/api', () => ({
  api: {
    rooms: { list: mocks.roomsList },
    sessions: { list: mocks.sessionsList },
    tournaments: { reconcileSummary: mocks.reconcileSummary }
  }
}))

vi.mock('../src/components/TournamentPopup', () => ({
  TournamentPopup: () => null
}))

const room: Room = {
  id: 6,
  name: 'PokerDom',
  cashCurrency: 'RUB',
  tournamentCurrency: 'RUB',
  rateSource: 'pokerdom',
  color: '#6ee7b7',
  isWallet: false,
  createdAt: '2026-09-01 00:00:00'
}

function day(date: string, totalUsd: number): SessionDay {
  return {
    date,
    totalUsd,
    rooms: [
      {
        roomId: room.id,
        roomName: room.name,
        currency: 'RUB',
        delta: totalUsd,
        flowInUsd: 0,
        flowOutUsd: 0,
        profitUsd: totalUsd,
        casinoUsd: 0,
        pokerProfitUsd: totalUsd,
        convertible: true
      }
    ]
  }
}

const days: SessionDay[] = [day('2026-09-28', -1000), day('2026-09-29', 2000), day('2026-09-30', 3000)]

beforeEach(() => {
  mocks.roomsList.mockReset().mockResolvedValue([room])
  mocks.sessionsList.mockReset().mockResolvedValue(days)
  mocks.reconcileSummary.mockReset().mockResolvedValue([] as ReconcileFlag[])
})

function renderedDates(): string[] {
  const seen: string[] = []
  for (const node of Array.from(document.querySelectorAll('span'))) {
    const text = node.textContent ?? ''
    if (/^\d{4}-\d{2}-\d{2}$/.test(text.trim())) seen.push(text.trim())
  }
  return seen
}

describe('SessionsPage: newest day on top', () => {
  it('renders the day cards from the newest date to the oldest', async () => {
    render(<SessionsPage />)

    await waitFor(() => expect(renderedDates()).toHaveLength(3))
    expect(renderedDates()).toEqual(['2026-09-30', '2026-09-29', '2026-09-28'])
  })

  it('keeps the summary totals independent from the display order', async () => {
    render(<SessionsPage />)

    await waitFor(() => expect(renderedDates()).toHaveLength(3))
    // -1000 + 2000 + 3000 = +4000 cents = $40.00 — «Итого» не зависит от порядка карточек
    expect(screen.getAllByText('$40.00')).toHaveLength(1)
    // лучший/худший день в шапке + итог самой карточки этого дня
    expect(screen.getAllByText('$30.00')).toHaveLength(2)
    expect(screen.getAllByText('$-10.00')).toHaveLength(2)
  })

  it('renders the header and every data row with one shared CSS grid in each card', async () => {
    render(<SessionsPage />)

    await waitFor(() => expect(renderedDates()).toHaveLength(3))
    const rows = document.querySelectorAll('[class*="grid-cols-12"]')
    // 3 карточки × (строка заголовков + строка данных одного рума)
    expect(rows).toHaveLength(6)
    for (const row of rows) {
      const cells = row.children
      expect(cells).toHaveLength(4)
      expect((cells[0] as HTMLElement).className).toContain('col-span-4')
      expect((cells[1] as HTMLElement).className).toContain('col-span-3')
      expect((cells[2] as HTMLElement).className).toContain('col-span-3')
      expect((cells[3] as HTMLElement).className).toContain('col-span-2')
    }
  })

  it('shows the pure-poker profit and breaks the casino P&L out underneath', async () => {
    mocks.sessionsList.mockResolvedValue([
      {
        date: '2026-09-30',
        totalUsd: 10000,
        rooms: [
          {
            roomId: room.id,
            roomName: room.name,
            currency: 'RUB',
            delta: 7000,
            flowInUsd: 0,
            flowOutUsd: 0,
            profitUsd: 7000,
            casinoUsd: -3000,
            pokerProfitUsd: 10000,
            convertible: true
          }
        ]
      }
    ])
    render(<SessionsPage />)

    await waitFor(() => expect(renderedDates()).toHaveLength(1))
    // «Профит» — чистый покер (pokerProfitUsd), а не балансовая разница (profitUsd)
    expect(screen.getByText('+$100.00')).toBeTruthy()
    expect(screen.queryByText('+$70.00')).toBeNull()
    // казино показано отдельной строкой-подписью
    expect(screen.getByText('↳ Казино: −$30.00')).toBeTruthy()
  })
})
