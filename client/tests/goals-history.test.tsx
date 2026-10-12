import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GoalsPage } from '../src/goals/GoalsPage'
import type { GoalWithProgress } from '../src/goals/goals.types'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('../src/lib/api', async (importOriginal) => {
  const api = await importOriginal<typeof import('../src/lib/api')>()
  return { ...api, request: mocks.request }
})

function goal(over: Partial<GoalWithProgress> = {}): GoalWithProgress {
  return {
    id: 1,
    metric: 'distance',
    targetUnits: 100,
    currency: 'USD',
    deadline: null,
    title: null,
    checklist: [],
    status: 'active',
    createdAt: '2026-09-01 00:00:00',
    achievedAt: null,
    failedAt: null,
    closedAt: null,
    acknowledgedAt: null,
    finalPercent: null,
    finalUnits: null,
    sortOrder: 0,
    progress: { currentUnits: 40, percent: 40, blank: false },
    entries: [],
    ...over
  }
}

function stub(goals: GoalWithProgress[]): void {
  mocks.request.mockImplementation(async (path: string) => (path === '/goals' ? { goals } : {}))
}

beforeEach(() => {
  mocks.request.mockReset()
})

describe('GoalsPage history', () => {
  it('separates active goals from the history tab', async () => {
    stub([
      goal({ id: 1 }),
      goal({
        id: 2,
        metric: 'custom',
        targetUnits: 1,
        title: 'Марафон',
        status: 'achieved',
        achievedAt: '2026-09-18 10:00:00',
        acknowledgedAt: '2026-09-18 11:00:00',
        finalPercent: 100,
        finalUnits: null,
        progress: { currentUnits: null, percent: 100, blank: false }
      })
    ])
    const user = userEvent.setup()
    render(<GoalsPage />)

    expect(await screen.findByRole('tab', { name: /Активные/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /История/ })).toBeTruthy()
    expect(screen.getByText('Сыграть 100 турниров')).toBeTruthy()
    expect(screen.queryByText('Марафон')).toBeNull()

    await user.click(screen.getByRole('tab', { name: /История/ }))
    expect(screen.getByText('Марафон')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Сыграть 100 турниров')).toBeNull())
  })

  it('renders history cards read-only', async () => {
    stub([
      goal({
        id: 3,
        status: 'failed',
        failedAt: '2026-09-19 10:00:00',
        acknowledgedAt: '2026-09-19 11:00:00',
        finalPercent: 40,
        finalUnits: 40
      })
    ])
    const user = userEvent.setup()
    render(<GoalsPage />)

    await user.click(await screen.findByRole('tab', { name: /История/ }))
    expect(screen.queryByRole('button', { name: 'Закрыть цель' })).toBeNull()

    await user.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('Дневник')).toBeTruthy()
    expect(screen.queryByLabelText('Заметка в дневник')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Завершить' })).toBeNull()
  })

  it('keeps an unacknowledged finished goal in the active tab', async () => {
    stub([
      goal({ id: 1 }),
      goal({
        id: 4,
        targetUnits: 50,
        status: 'achieved',
        achievedAt: '2026-09-20 10:00:00',
        acknowledgedAt: null,
        finalPercent: 100,
        finalUnits: 50
      })
    ])
    const user = userEvent.setup()
    render(<GoalsPage />)

    expect(await screen.findByText('Сыграть 50 турниров')).toBeTruthy()
    expect(screen.getByText('Сыграть 100 турниров')).toBeTruthy()

    await user.click(screen.getByRole('tab', { name: /История/ }))
    await waitFor(() => expect(screen.queryByText('Сыграть 50 турниров')).toBeNull())
  })
})
