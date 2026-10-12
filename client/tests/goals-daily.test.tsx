import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GoalsPage } from '../src/goals/GoalsPage'
import type { GoalWithProgress } from '../src/goals/goals.types'
import { currentMonthKey, monthLabel, monthStart } from '../src/goals/metrics'

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
    createdAt: '2026-10-11 00:00:00',
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

const thisMonth = currentMonthKey()

function dailyGoal(over: Partial<GoalWithProgress> = {}): GoalWithProgress {
  return goal({
    id: 10,
    metric: 'daily',
    targetUnits: 1,
    title: 'Зарядка',
    deadline: `${thisMonth}-12`,
    status: 'achieved',
    achievedAt: '2026-10-12 09:00:00',
    acknowledgedAt: '2026-10-12 09:00:00',
    finalPercent: 100,
    finalUnits: null,
    progress: { currentUnits: null, percent: 100, blank: false },
    ...over
  })
}

const regular = [
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
  }),
  dailyGoal({ id: 3 }),
  dailyGoal({
    id: 4,
    title: 'Сегодня',
    status: 'active',
    achievedAt: null,
    acknowledgedAt: null,
    finalPercent: null,
    progress: { currentUnits: null, percent: 0, blank: false }
  })
]

function stubDaily(): void {
  mocks.request.mockImplementation(async (path: string) => {
    if (path === '/goals') return { goals: regular }
    if (path.includes(`startDate=${monthStart(thisMonth)}`)) return { goals: [dailyGoal({ id: 3 })] }
    return { goals: [] }
  })
}

beforeEach(() => {
  mocks.request.mockReset()
})

describe('GoalsPage daily tab', () => {
  it('routes goals across the three tabs and counts the daily month', async () => {
    stubDaily()
    render(<GoalsPage />)

    expect(await screen.findByText('Сыграть 100 турниров')).toBeTruthy()
    expect(screen.getByText('Сегодня')).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('tab', { name: /Ежедневник/ }).textContent).toContain('1'))

    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: /История/ }))
    expect(screen.getByText('Марафон')).toBeTruthy()
    expect(screen.queryByText('Зарядка')).toBeNull()

    await user.click(screen.getByRole('tab', { name: /Ежедневник/ }))
    expect(await screen.findByText('Зарядка')).toBeTruthy()
    expect(screen.getByText(monthLabel(thisMonth))).toBeTruthy()
    expect(screen.queryByText('Сыграть 100 турниров')).toBeNull()
  })

  it('loads only finished daily goals of the month', async () => {
    stubDaily()
    render(<GoalsPage />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('tab', { name: /Ежедневник/ }))
    await screen.findByText('Зарядка')

    const calls = mocks.request.mock.calls.map((call) => String(call[0])).filter((path) => path.startsWith('/goals?metric=daily'))
    expect(calls.length).toBeGreaterThan(0)
    expect(calls[0]).toContain('metric=daily')
    expect(calls[0]).toContain(`startDate=${monthStart(thisMonth)}`)
    expect(calls[0]).toContain('includeFinishedDaily=1')
    expect(calls[0]).toContain('finishedOnly=1')
  })

  it('renders the daily card read-only and expanded by default', async () => {
    stubDaily()
    render(<GoalsPage />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('tab', { name: /Ежедневник/ }))
    await screen.findByText('Зарядка')
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy()
    expect(screen.getByText('Дневник')).toBeTruthy()

    await user.click(screen.getByRole('button', { expanded: true }))
    await waitFor(() => expect(screen.queryByText('Дневник')).toBeNull())
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy()

    await user.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('Дневник')).toBeTruthy()

    expect(screen.queryByLabelText('Заметка в дневник')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Выполнено' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Закрыть цель' })).toBeNull()
  })

  it('navigates between months with the picker', async () => {
    stubDaily()
    render(<GoalsPage />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('tab', { name: /Ежедневник/ }))
    await screen.findByText('Зарядка')
    expect((screen.getByRole('button', { name: 'Следующий месяц' }) as HTMLButtonElement).disabled).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Предыдущий месяц' }))
    expect(await screen.findByText(/Завершённых дел в этом месяце пока нет/)).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Зарядка')).toBeNull())
    expect((screen.getByRole('button', { name: 'Следующий месяц' }) as HTMLButtonElement).disabled).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Следующий месяц' }))
    expect(await screen.findByText('Зарядка')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Следующий месяц' }) as HTMLButtonElement).disabled).toBe(true)
  })
})