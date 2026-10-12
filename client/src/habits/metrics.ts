import type { HabitStatus, HabitWithLogs } from './habits.types'

export const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
export const MONTHS_RU_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
export const WEEKDAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export const MAX_HABIT_NAME = 100

export interface MonthDay {
  date: string
  day: number
  weekday: string
  weekend: boolean
}

export function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function currentMonthKey(): string {
  return dayKey(new Date()).slice(0, 7)
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return `${MONTHS_RU[m - 1]} ${y}`
}

export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return `${d} ${MONTHS_RU[m - 1]?.toLowerCase()} ${y}`
}

export function shortDayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return `${d} ${MONTHS_RU_SHORT[m - 1]} ${y}`
}

/** Counts code points, so an emoji in the name costs one character, not two. */
export function charCount(value: string): number {
  return [...value].length
}

export function pluralRu(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const total = y * 12 + (m - 1) + delta
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

export function monthDays(month: string): MonthDay[] {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const out: MonthDay[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`
    const weekdayIndex = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
    out.push({ date, day: d, weekday: WEEKDAYS_RU[weekdayIndex] ?? '', weekend: weekdayIndex >= 5 })
  }
  return out
}

/** A partially kept day is a success for progress, a miss is not. Empty days are ignored. */
export function progressPercent(counts: { done: number; partial: number; missed: number }): number | null {
  const tracked = counts.done + counts.partial + counts.missed
  if (tracked === 0) return null
  return Math.round(((counts.done + counts.partial) / tracked) * 100)
}

export function habitMonthProgress(habit: HabitWithLogs, days: MonthDay[]): number | null {
  let done = 0
  let partial = 0
  let missed = 0
  for (const day of days) {
    const status: HabitStatus | undefined = habit.logs[day.date]
    if (status === 'done') done += 1
    else if (status === 'partial') partial += 1
    else if (status === 'missed') missed += 1
  }
  return progressPercent({ done, partial, missed })
}

export interface MonthProgress {
  percent: number | null
  success: number
  tracked: number
}

export function overallMonthProgress(habits: HabitWithLogs[], days: MonthDay[]): MonthProgress {
  let success = 0
  let tracked = 0
  for (const habit of habits) {
    for (const day of days) {
      const status: HabitStatus | undefined = habit.logs[day.date]
      if (status === 'done' || status === 'partial') {
        success += 1
        tracked += 1
      } else if (status === 'missed') {
        tracked += 1
      }
    }
  }
  return { percent: tracked === 0 ? null : Math.round((success / tracked) * 100), success, tracked }
}