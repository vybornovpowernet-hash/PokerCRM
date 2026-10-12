import { render, screen, waitFor } from '@testing-library/react'
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
  mocks.calendar.mockReset().mockResolvedValue({ year: 2026, month: 9, totalCount: 0, totalProfitUsd: 0, days: [], blank: null })
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
