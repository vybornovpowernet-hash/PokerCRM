import { describe, expect, it } from 'vitest'
import {
  formatPoints,
  habitMonthProgress,
  monthDays,
  monthPoints,
  overallMonthProgress,
  progressPercent,
  type MonthDay
} from '../src/habits/metrics'
import type { HabitWithLogs } from '../src/habits/habits.types'

const days: MonthDay[] = monthDays('2026-01')

function habitWithLogs(logs: HabitWithLogs['logs']): HabitWithLogs {
  return {
    id: 1,
    name: 'Медитация',
    color: '#f1f5f9',
    createdAt: '2026-01-01 00:00:00',
    startDay: '2026-01-01',
    archivedAt: null,
    sortOrder: 0,
    logs
  }
}

describe('progressPercent', () => {
  it('weights a partial day as half a point', () => {
    expect(progressPercent({ done: 1, partial: 1, missed: 0 })).toBe(75)
    expect(progressPercent({ done: 0, partial: 1, missed: 1 })).toBe(25)
    expect(progressPercent({ done: 0, partial: 2, missed: 0 })).toBe(50)
    expect(progressPercent({ done: 0, partial: 0, missed: 0 })).toBeNull()
  })

  it('keeps pure done/missed months unchanged', () => {
    expect(progressPercent({ done: 1, partial: 0, missed: 1 })).toBe(50)
    expect(progressPercent({ done: 2, partial: 0, missed: 0 })).toBe(100)
    expect(progressPercent({ done: 0, partial: 0, missed: 2 })).toBe(0)
  })
})

describe('monthPoints', () => {
  it('sums done as whole points and partial as halves', () => {
    expect(monthPoints({ done: 2, partial: 1 })).toBe(2.5)
    expect(monthPoints({ done: 0, partial: 3 })).toBe(1.5)
    expect(monthPoints({ done: 4, partial: 0 })).toBe(4)
  })
})

describe('habitMonthProgress', () => {
  it('counts only days that carry a log', () => {
    const habit = habitWithLogs({ '2026-01-10': 'done', '2026-01-11': 'partial' })
    expect(habitMonthProgress(habit, days)).toBe(75)
  })

  it('returns null for a month without logs', () => {
    expect(habitMonthProgress(habitWithLogs({}), days)).toBeNull()
  })
})

describe('overallMonthProgress', () => {
  it('aggregates weighted points across habits and keeps tracked whole', () => {
    const first = { ...habitWithLogs({ '2026-01-10': 'done' }), id: 1 }
    const second = { ...habitWithLogs({ '2026-01-10': 'partial', '2026-01-11': 'missed' }), id: 2 }
    expect(overallMonthProgress([first, second], days)).toEqual({ percent: 50, points: 1.5, tracked: 3 })
  })

  it('counts a partial-only month as 50 percent', () => {
    const habit = habitWithLogs({ '2026-01-10': 'partial', '2026-01-11': 'partial' })
    expect(overallMonthProgress([habit], days)).toEqual({ percent: 50, points: 1, tracked: 2 })
  })

  it('agrees with the per-habit percent for a single habit', () => {
    const habit = habitWithLogs({ '2026-01-10': 'done', '2026-01-11': 'partial', '2026-01-12': 'missed' })
    const overall = overallMonthProgress([habit], days)
    expect(overall.percent).toBe(habitMonthProgress(habit, days))
    expect(overall.points).toBe(1.5)
  })
})

describe('formatPoints', () => {
  it('drops the tail for whole points and keeps one decimal for halves', () => {
    expect(formatPoints(7)).toBe('7')
    expect(formatPoints(0)).toBe('0')
    expect(formatPoints(6.5)).toBe('6.5')
    expect(formatPoints(0.5)).toBe('0.5')
    expect(formatPoints(1.5)).toBe('1.5')
  })
})
