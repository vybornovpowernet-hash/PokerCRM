import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GoalsPage } from '../src/goals/GoalsPage'
import { applyGoalOrder, moveGoalId } from '../src/goals/order'
import type { GoalWithProgress } from '../src/goals/goals.types'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('../src/lib/api', async (importOriginal) => {
  const api = await importOriginal<typeof import('../src/lib/api')>()
  return { ...api, request: mocks.request }
})

function goal(over: Partial<GoalWithProgress> = {}): GoalWithProgress {
  return {
    id: 1,
    metric: 'custom',
    targetUnits: 1,
    currency: 'USD',
    deadline: null,
    title: 'Первая',
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
    progress: { currentUnits: null, percent: 0, blank: false },
    entries: [],
    ...over
  }
}

function titles(): string[] {
  return screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent ?? '')
}

describe('applyGoalOrder', () => {
  it('permutes the listed goals among the slots they already occupy', () => {
    const goals = [goal({ id: 1 }), goal({ id: 2 }), goal({ id: 3 })]

    expect(applyGoalOrder(goals, [3, 1, 2]).map((item) => item.id)).toEqual([3, 1, 2])
    expect(applyGoalOrder(goals, [2, 1]).map((item) => item.id)).toEqual([2, 1, 3])
  })

  it('falls back to the untouched list for unknown or duplicated ids', () => {
    const goals = [goal({ id: 1 }), goal({ id: 2 }), goal({ id: 3 })]

    expect(applyGoalOrder(goals, [9, 1])).toBe(goals)
    expect(applyGoalOrder(goals, [1, 1])).toBe(goals)
  })
})

describe('moveGoalId', () => {
  it('swaps a goal with its neighbour and refuses to leave the list', () => {
    expect(moveGoalId([1, 2, 3], 2, -1)).toEqual([2, 1, 3])
    expect(moveGoalId([1, 2, 3], 2, 1)).toEqual([1, 3, 2])

    const ids = [1, 2, 3]
    expect(moveGoalId(ids, 1, -1)).toBe(ids)
    expect(moveGoalId(ids, 3, 1)).toBe(ids)
    expect(moveGoalId(ids, 9, 1)).toBe(ids)
  })
})

describe('GoalsPage ordering', () => {
  beforeEach(() => {
    mocks.request.mockReset()
  })

  function stub(goals: GoalWithProgress[]): void {
    mocks.request.mockImplementation(async (path: string, init?: { body?: string }) => {
      if (path === '/goals') return { goals }
      if (path === '/goals/order') {
        const ids = JSON.parse(init?.body ?? '{"ids":[]}').ids as number[]
        return { goals: applyGoalOrder(goals, ids) }
      }
      return {}
    })
  }

  it('renders the active tab as a reorderable list', async () => {
    stub([goal({ id: 1 }), goal({ id: 2, title: 'Вторая' })])
    render(<GoalsPage />)

    const list = await screen.findByRole('list', { name: /Активные цели/ })
    expect(list.tagName).toBe('UL')
    expect(list.textContent).toContain('Первая')
    expect(list.textContent).toContain('Вторая')
  })

  it('reorders with Alt+Arrow and persists the new order', async () => {
    stub([goal({ id: 1 }), goal({ id: 2, title: 'Вторая' })])
    render(<GoalsPage />)

    await screen.findByRole('heading', { level: 3, name: 'Первая' })
    fireEvent.keyDown(screen.getByRole('heading', { level: 3, name: 'Первая' }).closest('button') as HTMLElement, {
      key: 'ArrowDown',
      altKey: true
    })

    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('/goals/order', expect.objectContaining({ method: 'PUT' })))
    const call = mocks.request.mock.calls.find(([path]) => path === '/goals/order')
    expect(JSON.parse((call?.[1] as { body: string }).body)).toEqual({ ids: [2, 1] })
    await waitFor(() => expect(titles()).toEqual(['Вторая', 'Первая']))
  })

  it('does not reorder past the edge of the list', async () => {
    stub([goal({ id: 1 }), goal({ id: 2, title: 'Вторая' })])
    render(<GoalsPage />)

    await screen.findByRole('heading', { level: 3, name: 'Первая' })
    fireEvent.keyDown(screen.getByRole('heading', { level: 3, name: 'Первая' }).closest('button') as HTMLElement, {
      key: 'ArrowUp',
      altKey: true
    })
    fireEvent.keyDown(screen.getByRole('heading', { level: 3, name: 'Первая' }).closest('button') as HTMLElement, {
      key: 'ArrowDown',
      altKey: false
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mocks.request.mock.calls.some(([path]) => path === '/goals/order')).toBe(false)
  })
})
