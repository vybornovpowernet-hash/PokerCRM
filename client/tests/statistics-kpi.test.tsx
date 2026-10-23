import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StatisticsPage from '../src/pages/Statistics'
import type { Room, SessionStatsResult } from '../src/lib/types'

const mocks = vi.hoisted(() => ({
  roomsList: vi.fn(),
  stats: vi.fn(),
  calendar: vi.fn()
}))

vi.mock('../src/lib/api', () => ({
  api: {
    rooms: { list: mocks.roomsList },
    statistics: { sessions: mocks.stats, calendar: mocks.calendar }
  }
}))

const room: Room = {
  id: 7,
  name: 'RedStar',
  cashCurrency: 'EUR',
  tournamentCurrency: 'EUR',
  rateSource: null,
  color: '#fda4af',
  isWallet: false,
  createdAt: '2026-09-01 00:00:00'
}

function stats(over: Partial<SessionStatsResult> = {}): SessionStatsResult {
  return {
    sessions: [{ date: '2026-09-25', profitUsd: 1000 }],
    totalProfitUsd: 1000,
    bestSessionUsd: 1000,
    worstSessionUsd: 1000,
    tournamentCount: 9,
    mbrCount: 0,
    topTournament: null,
    tournamentDays: [],
    profitSeries: [],
    averageBuyinUsd: 500,
    roiPercent: 12,
    ...over
  }
}

beforeEach(() => {
  mocks.roomsList.mockReset().mockResolvedValue([room])
  mocks.stats.mockReset().mockResolvedValue(stats())
  mocks.calendar.mockReset().mockResolvedValue({
    mode: 'calendar',
    dateFrom: '2026-09-01',
    dateTo: '2026-09-30',
    totalCount: 0,
    totalProfitUsd: 0,
    blank: null,
    months: [{ year: 2026, month: 9, days: [] }]
  })
})

function card(label: string): HTMLElement {
  return screen.getByText(label).closest('div')?.parentElement as HTMLElement
}

describe('StatisticsPage KPI row', () => {
  it('shows the tournament count with the MBR subset as a caption', async () => {
    render(<StatisticsPage />)

    await waitFor(() => expect(screen.getByText('Турниров')).toBeDefined())
    const tournaments = card('Турниров')
    expect(tournaments.textContent).toContain('9')
    expect(tournaments.textContent).toContain('в т.ч. 0 MBR')
  })

  it('adds the best tournament with its room and date', async () => {
    mocks.stats.mockResolvedValue(
      stats({ mbrCount: 12, topTournament: { profitUsd: 3738, date: '2026-09-25', roomId: room.id, roomName: room.name } })
    )
    render(<StatisticsPage />)

    await waitFor(() => expect(screen.getByText('Лучший турнир')).toBeDefined())
    const best = card('Лучший турнир')
    expect(best.textContent).toContain('$37.38')
    expect(best.textContent).toContain('RedStar · 25.09.2026')
    // the room caption keeps the room color
    expect((card('Лучший турнир').querySelector('div[style]') as HTMLElement).style.color).toBe('rgb(253, 164, 175)')
    expect(card('Турниров').textContent).toContain('в т.ч. 12 MBR')
  })

  it('falls back to a dash when the period has no tournaments', async () => {
    mocks.stats.mockResolvedValue(stats({ tournamentCount: 0, mbrCount: 0, bestSessionUsd: null, worstSessionUsd: null }))
    render(<StatisticsPage />)

    await waitFor(() => expect(screen.getByText('Лучший турнир')).toBeDefined())
    expect(card('Лучший турнир').textContent).toContain('—')
  })
})

describe('StatisticsPage activity calendar', () => {
  it('passes the page filters (period and rooms) to the calendar endpoint', async () => {
    render(<StatisticsPage />)

    await waitFor(() => expect(mocks.calendar).toHaveBeenCalled())
    const [from, to, roomIds] = mocks.calendar.mock.calls[0] as [string, string, number[]]
    // preset «За месяц» → from the 1st of the current month, no room filter yet
    expect(from).toMatch(/^\d{4}-\d{2}-01$/)
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(roomIds).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'RedStar' }))
    await waitFor(() => expect(mocks.calendar).toHaveBeenLastCalledWith(from, to, [room.id]))
  })

  it('renders a full calendar month even when the period is a single day', async () => {
    const days = Array.from({ length: 31 }, (_, i) => ({
      date: `2026-10-${String(i + 1).padStart(2, '0')}`,
      count: i === 13 ? 3 : 0,
      profitUsd: i === 13 ? 450 : null
    }))
    mocks.calendar.mockResolvedValue({
      mode: 'calendar',
      dateFrom: '2026-10-14',
      dateTo: '2026-10-14',
      totalCount: 3,
      totalProfitUsd: 450,
      blank: null,
      months: [{ year: 2026, month: 10, days }]
    })
    const { container } = render(<StatisticsPage />)

    await waitFor(() => expect(container.querySelectorAll('[title^="2026-10-"]')).toHaveLength(31))
    expect(screen.getByText('Октябрь 2026')).toBeDefined()
  })

  it('renders one cell per month when the server reports a long period', async () => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, '0')}`,
      count: i === 0 ? 12 : 0,
      profitUsd: i === 0 ? 1200 : null
    }))
    mocks.calendar.mockResolvedValue({
      mode: 'months',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      totalCount: 12,
      totalProfitUsd: 1200,
      blank: null,
      months
    })
    render(<StatisticsPage />)

    await waitFor(() => expect(screen.getByText('по месяцам')).toBeDefined())
    expect(screen.getByText('Янв 2026')).toBeDefined()
    expect(screen.getByText('Дек 2026')).toBeDefined()
    expect(screen.getByText('2026')).toBeDefined()
  })
})
