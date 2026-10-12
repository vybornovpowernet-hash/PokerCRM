import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TournamentsPage from '../src/pages/Tournaments'
import type { MbrSummary, Room, TournamentGroup, TournamentSummary } from '../src/lib/types'

const mocks = vi.hoisted(() => ({
  roomsList: vi.fn(),
  summary: vi.fn()
}))

vi.mock('../src/lib/api', () => ({
  api: {
    rooms: { list: mocks.roomsList },
    tournaments: { summary: mocks.summary }
  }
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: {
    count: number
    estimateSize: (index: number) => number
    getItemKey?: (index: number) => string | number
  }) => {
    const items = Array.from({ length: options.count }, (_, index) => {
      const size = options.estimateSize(index)
      return {
        index,
        key: options.getItemKey ? options.getItemKey(index) : index,
        start: index * size,
        size
      }
    })
    return {
      getVirtualItems: () => items,
      getTotalSize: () => items.reduce((sum, item) => sum + item.size, 0),
      measureElement: () => undefined,
      measure: () => undefined
    }
  }
}))

const room: Room = {
  id: 1,
  name: 'GG',
  cashCurrency: 'USD',
  tournamentCurrency: 'USD',
  rateSource: 'er-api',
  color: '#fde68a',
  isWallet: false,
  createdAt: '2026-09-01 00:00:00'
}

function group(key: string, label: string, count: number, profitUsd: number): TournamentGroup {
  return {
    key,
    label,
    count,
    totalBuyinUsd: count * 1000,
    totalProfitUsd: profitUsd,
    roiPercent: 10,
    bestRank: null,
    avgEntrants: null,
    rows: [
      { date: '2026-09-30', roomName: 'GG', place: '3 из 120', buyinUsd: 1000, profitUsd: 5000 },
      { date: '2026-09-29', roomName: 'GG', place: null, buyinUsd: 1000, profitUsd: -2000 }
    ]
  }
}

function summary(groups: TournamentGroup[]): { summary: TournamentSummary; mbr: MbrSummary } {
  return {
    summary: { count: 8, totalBuyinUsd: 8000, totalProfitUsd: 7000, roiPercent: 20, blank: null, groups },
    mbr: { count: 0, totalBuyinUsd: 0, totalProfitUsd: 0, roiPercent: null, avgPosition: null, blank: null, breakdown: [] }
  }
}

const groups = [group('name:aaa', 'aaa', 2, 5000), group('name:bbb', 'bbb', 1, -1000), group('name:ccc', 'ccc', 5, 3000)]

beforeEach(() => {
  mocks.roomsList.mockReset().mockResolvedValue([room])
  mocks.summary.mockReset().mockResolvedValue(summary(groups))
})

function labelOrder(): string[] {
  return screen
    .getAllByText(/^(aaa|bbb|ccc)$/)
    .map((node) => node.textContent ?? '')
}

describe('TournamentsPage: virtualized groups list', () => {
  it('renders one row per group and keeps the header', async () => {
    render(<TournamentsPage />)

    await waitFor(() => expect(screen.getByText('aaa')).toBeTruthy())
    expect(labelOrder()).toHaveLength(3)
    expect(screen.getByText('Название')).toBeTruthy()
    expect(screen.getByText('Сыграно')).toBeTruthy()
  })

  it('sorts the virtualized rows when a column header is clicked', async () => {
    render(<TournamentsPage />)

    await waitFor(() => expect(screen.getByText('aaa')).toBeTruthy())
    // по умолчанию сортировка по профиту убыв.: aaa(50), ccc(30), bbb(-10)
    expect(labelOrder()).toEqual(['aaa', 'ccc', 'bbb'])

    fireEvent.click(screen.getByText('Название'))
    await waitFor(() => expect(labelOrder()).toEqual(['ccc', 'bbb', 'aaa']))
  })

  it('reveals the virtualized detail rows when a group is expanded', async () => {
    render(<TournamentsPage />)

    await waitFor(() => expect(screen.getByText('bbb')).toBeTruthy())
    expect(screen.queryByText('2026-09-30')).toBeNull()

    fireEvent.click(screen.getByText('bbb'))
    await waitFor(() => expect(screen.getByText('2026-09-30')).toBeTruthy())
    expect(screen.getByText('2026-09-29')).toBeTruthy()
    expect(screen.getByText('Ручные строки (без названия): агрегируются по лимиту бай-ина.')).toBeTruthy()
  })
})
