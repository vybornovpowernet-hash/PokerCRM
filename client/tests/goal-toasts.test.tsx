import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GoalToasts } from '../src/goals/components/GoalToasts'
import type { GoalWithProgress } from '../src/goals/goals.types'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('../src/lib/api', async (importOriginal) => {
  const api = await importOriginal<typeof import('../src/lib/api')>()
  return { ...api, request: mocks.request }
})

interface RejectionHook {
  on(event: 'unhandledRejection', handler: (reason: unknown) => void): void
  off(event: 'unhandledRejection', handler: (reason: unknown) => void): void
}

function rejectionHook(): RejectionHook | undefined {
  return (globalThis as unknown as { process?: RejectionHook }).process
}

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

beforeEach(() => {
  mocks.request.mockReset()
})

describe('GoalToasts', () => {
  it('shows only unacknowledged finished goals and clears them on acknowledge', async () => {
    const active = goal({ id: 1 })
    const done = goal({
      id: 2,
      status: 'achieved',
      achievedAt: '2026-09-20 10:00:00',
      acknowledgedAt: null,
      progress: { currentUnits: 100, percent: 100, blank: false }
    })
    const archived = goal({
      id: 3,
      status: 'failed',
      failedAt: '2026-09-19 10:00:00',
      acknowledgedAt: '2026-09-19 11:00:00',
      progress: { currentUnits: 40, percent: 40, blank: false }
    })

    let acknowledged = false
    mocks.request.mockImplementation(async (path: string) => {
      if (path === '/goals/2/acknowledge') {
        acknowledged = true
        return { goal: { ...done, acknowledgedAt: '2026-09-21 10:00:00' } }
      }
      return { goals: [active, acknowledged ? { ...done, acknowledgedAt: '2026-09-21 10:00:00' } : done, archived] }
    })

    const user = userEvent.setup()
    render(<GoalToasts />)

    expect(await screen.findByText(/Цель выполнена/)).toBeTruthy()
    expect(screen.queryByText(/Время вышло/)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Подтвердить уведомление' }))
    await waitFor(() => expect(screen.queryByText(/Цель выполнена/)).toBeNull())
    expect(mocks.request).toHaveBeenCalledWith('/goals/2/acknowledge', expect.objectContaining({ method: 'POST' }))
  })

  it('renders nothing when there are no unacknowledged finished goals', async () => {
    mocks.request.mockResolvedValue({ goals: [goal({ id: 1 })] })
    render(<GoalToasts />)

    await waitFor(() => expect(mocks.request).toHaveBeenCalled())
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('swallows a failed background refresh without an unhandled rejection', async () => {
    mocks.request.mockRejectedValue(new Error('offline'))
    const rejections: unknown[] = []
    const proc = rejectionHook()
    expect(proc).toBeDefined()
    const onRejection = (reason: unknown) => {
      rejections.push(reason)
    }
    proc?.on('unhandledRejection', onRejection)
    try {
      render(<GoalToasts />)
      await waitFor(() => expect(mocks.request).toHaveBeenCalled())

      window.dispatchEvent(new Event('goals-changed'))
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(rejections).toEqual([])
      expect(screen.queryByRole('status')).toBeNull()
    } finally {
      proc?.off('unhandledRejection', onRejection)
    }
  })
})
