import { describe, expect, it } from 'vitest'
import {
  checklistProgressLabel,
  currentLabel,
  daysBetween,
  dayKey,
  formatDateShort,
  formatMoneyUsd,
  goalOutcomeTitle,
  goalPhrase,
  goalTimeLabel,
  groupThousands,
  historyDate,
  pluralDays,
  pluralTournaments,
  targetLabel,
  STATUS_LABELS
} from '../src/goals/metrics'

describe('goals metrics formatting', () => {
  it('groups thousands with spaces', () => {
    expect(groupThousands(0)).toBe('0')
    expect(groupThousands(100)).toBe('100')
    expect(groupThousands(5000)).toBe('5\u00A0000')
    expect(groupThousands(1234567)).toBe('1\u00A0234\u00A0567')
    expect(groupThousands(-1234)).toBe('-1\u00A0234')
  })

  it('pluralises the Russian tournament noun', () => {
    expect(pluralTournaments(1)).toBe('турнир')
    expect(pluralTournaments(2)).toBe('турнира')
    expect(pluralTournaments(5)).toBe('турниров')
    expect(pluralTournaments(21)).toBe('турнир')
    expect(pluralTournaments(24)).toBe('турнира')
    expect(pluralTournaments(11)).toBe('турниров')
    expect(pluralTournaments(101)).toBe('турнир')
  })

  it('formats money in USD min units, dropping zero kopecks', () => {
    expect(formatMoneyUsd(0)).toBe('$0')
    expect(formatMoneyUsd(500000)).toBe('$5\u00A0000')
    expect(formatMoneyUsd(500050)).toBe('$5\u00A0000.50')
    expect(formatMoneyUsd(123456789)).toBe('$1\u00A0234\u00A0567.89')
  })

  it('labels targets by metric', () => {
    expect(targetLabel({ metric: 'bankroll', targetUnits: 500000 })).toBe('$5\u00A0000')
    expect(targetLabel({ metric: 'distance', targetUnits: 100 })).toBe('100 турниров')
    expect(targetLabel({ metric: 'distance', targetUnits: 1 })).toBe('1 турнир')
    expect(targetLabel({ metric: 'custom', targetUnits: 1 })).toBe('')
  })

  it('labels current values by metric', () => {
    expect(currentLabel('bankroll', 342130)).toBe('$3\u00A0421.30')
    expect(currentLabel('distance', 57)).toBe('57 турниров')
    expect(currentLabel('custom', 0)).toBe('')
  })

  it('labels checklist progress with genitive pluralization', () => {
    expect(checklistProgressLabel([])).toBe('0 из 0 пунктов')
    expect(checklistProgressLabel([{ status: 'pending' }])).toBe('0 из 1 пункта')
    expect(checklistProgressLabel([{ status: 'completed' }, { status: 'pending' }])).toBe('1 из 2 пунктов')
    expect(checklistProgressLabel([{ status: 'completed' }, { status: 'failed' }, { status: 'pending' }, { status: 'pending' }])).toBe('1 из 4 пунктов')
    expect(checklistProgressLabel([{ status: 'completed' }, { status: 'completed' }, { status: 'failed' }])).toBe('2 из 3 пунктов')
    expect(checklistProgressLabel(Array.from({ length: 21 }, () => ({ status: 'pending' as const })))).toBe('0 из 21 пункта')
    expect(checklistProgressLabel(Array.from({ length: 22 }, () => ({ status: 'completed' as const })))).toBe('22 из 22 пунктов')
  })

  it('builds the goal phrase', () => {
    expect(goalPhrase({ metric: 'bankroll', targetUnits: 500000 })).toBe('Банкролл до $5\u00A0000')
    expect(goalPhrase({ metric: 'distance', targetUnits: 21 })).toBe('Сыграть 21 турнир')
    expect(goalPhrase({ metric: 'custom', targetUnits: 1, title: 'Выучить испанский' })).toBe('Выучить испанский')
    expect(goalPhrase({ metric: 'custom', targetUnits: 1, title: '  слайд  ' })).toBe('слайд')
    expect(goalPhrase({ metric: 'custom', targetUnits: 1, title: '' })).toBe('Своя цель')
    expect(goalPhrase({ metric: 'custom', targetUnits: 1, title: null })).toBe('Своя цель')
  })

  it('keeps the status label set complete', () => {
    expect(STATUS_LABELS).toEqual({ active: 'В процессе', achieved: 'Достигнута', failed: 'Не достигнута' })
  })

  it('derives the history date from the terminal timestamp', () => {
    const base = { achievedAt: null, failedAt: null, closedAt: null }
    expect(historyDate({ status: 'active', ...base })).toBeNull()
    expect(historyDate({ status: 'achieved', ...base, achievedAt: '2026-09-18 10:00:00' })).toBe('2026-09-18')
    expect(historyDate({ status: 'failed', ...base, failedAt: '2026-09-19 10:00:00' })).toBe('2026-09-19')
    expect(historyDate({ status: 'failed', ...base, closedAt: '2026-09-20 10:00:00' })).toBe('2026-09-20')
  })

  it('labels the outcome notification', () => {
    expect(goalOutcomeTitle({ status: 'achieved' })).toBe('Цель выполнена')
    expect(goalOutcomeTitle({ status: 'failed' })).toBe('Время вышло / Провалена')
  })

  it('formats ISO dates as DD.MM.YYYY', () => {
    expect(formatDateShort('2026-09-17')).toBe('17.09.2026')
  })
})

describe('goals time helpers', () => {
  it('formats a Date into a day key in local time', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(dayKey(new Date(2026, 11, 31))).toBe('2026-12-31')
  })

  it('computes whole-day differences', () => {
    expect(daysBetween('2026-09-17', '2026-09-17')).toBe(0)
    expect(daysBetween('2026-09-17', '2026-09-18')).toBe(1)
    expect(daysBetween('2026-09-17', '2026-12-31')).toBe(105)
    expect(daysBetween('2026-12-31', '2026-09-17')).toBe(-105)
  })

  it('pluralises the Russian day noun', () => {
    expect(pluralDays(1)).toBe('день')
    expect(pluralDays(2)).toBe('дня')
    expect(pluralDays(5)).toBe('дней')
    expect(pluralDays(11)).toBe('дней')
    expect(pluralDays(21)).toBe('день')
    expect(pluralDays(24)).toBe('дня')
    expect(pluralDays(101)).toBe('день')
  })

  it('builds a deadline label from today to the deadline', () => {
    const today = '2026-09-17'
    expect(goalTimeLabel({ deadline: '2026-12-31', createdAt: '2026-09-01 00:00:00' }, today)).toEqual({ text: 'Осталось 105 дней', overdue: false })
    expect(goalTimeLabel({ deadline: '2026-09-18', createdAt: '2026-09-01 00:00:00' }, today)).toEqual({ text: 'Остался 1 день', overdue: false })
    expect(goalTimeLabel({ deadline: '2026-09-17', createdAt: '2026-09-01 00:00:00' }, today)).toEqual({ text: 'Дедлайн сегодня', overdue: false })
    expect(goalTimeLabel({ deadline: '2026-09-16', createdAt: '2026-09-01 00:00:00' }, today)).toEqual({ text: 'Дедлайн истек', overdue: true })
  })

  it('counts elapsed days from creation when no deadline', () => {
    expect(goalTimeLabel({ deadline: null, createdAt: '2026-09-17 00:00:00' }, '2026-09-17')).toEqual({ text: 'В процессе: сегодня', overdue: false })
    expect(goalTimeLabel({ deadline: null, createdAt: '2026-09-17 00:00:00' }, '2026-09-18')).toEqual({ text: 'В процессе: 1 день', overdue: false })
    expect(goalTimeLabel({ deadline: null, createdAt: '2026-09-01 00:00:00' }, '2026-09-17')).toEqual({ text: 'В процессе: 16 дней', overdue: false })
    expect(goalTimeLabel({ deadline: null, createdAt: '2026-07-01 00:00:00' }, '2026-09-17')).toEqual({ text: 'В процессе: 78 дней', overdue: false })
  })
})