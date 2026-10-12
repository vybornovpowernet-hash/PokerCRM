import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GoalTimeline } from '../src/goals/components/GoalTimeline'
import { PercentCounter } from '../src/goals/components/PercentCounter'
import type { GoalEntry } from '../src/goals/goals.types'

describe('GoalTimeline', () => {
  const stubProps = {
    readonly: false,
    busy: false,
    onEditEntry: async () => undefined,
    onDeleteEntry: async () => undefined
  } as const

  it('shows an empty hint when there are no entries', () => {
    render(<GoalTimeline entries={[]} {...stubProps} />)
    expect(screen.getByText(/Событий пока нет/)).toBeTruthy()
  })

  it('renders system milestones and user notes', () => {
    const entries: GoalEntry[] = [
      { id: 1, goalId: 1, kind: 'system', content: 'Пройдена половина пути', images: [], milestone: 50, createdAt: '2026-09-17 10:00:00' },
      { id: 2, goalId: 1, kind: 'user', content: 'Отличная сессия!', images: [], milestone: null, createdAt: '2026-09-17 12:00:00' }
    ]
    render(<GoalTimeline entries={entries} {...stubProps} />)
    expect(screen.getByText('Пройдена половина пути')).toBeTruthy()
    expect(screen.getByText('Отличная сессия!')).toBeTruthy()
    expect(screen.getAllByText('17.09.2026')).toHaveLength(2)
  })
})

describe('PercentCounter', () => {
  it('settles on the target value', async () => {
    render(<PercentCounter value={42} />)
    await waitFor(() => expect(screen.getByText('42')).toBeTruthy(), { timeout: 4000 })
  })
})