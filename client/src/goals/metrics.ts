import type { ChecklistStatus, Goal, GoalMetric, GoalStatus } from './goals.types'

export const STATUS_LABELS: Record<GoalStatus, string> = {
  active: 'В процессе',
  achieved: 'Достигнута',
  failed: 'Не достигнута'
}

export function historyDate(goal: Pick<Goal, 'status' | 'achievedAt' | 'failedAt' | 'closedAt'>): string | null {
  const raw =
    goal.status === 'achieved' ? goal.achievedAt : goal.status === 'failed' ? goal.failedAt ?? goal.closedAt : null
  return raw ? raw.slice(0, 10) : null
}

export function goalOutcomeTitle(goal: Pick<Goal, 'status'>): string {
  return goal.status === 'achieved' ? 'Цель выполнена' : 'Время вышло / Провалена'
}

export function pluralTournaments(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'турнир'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'турнира'
  return 'турниров'
}

export function groupThousands(n: number): string {
  const sign = n < 0 ? '-' : ''
  const digits = String(Math.abs(n))
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ' '
    out += digits[i]
  }
  return `${sign}${out}`
}

export function formatMoneyUsd(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  const whole = Math.floor(Math.abs(amount) / 100)
  const frac = Math.abs(amount) % 100
  return frac === 0 ? `${sign}$${groupThousands(whole)}` : `${sign}$${groupThousands(whole)}.${String(frac).padStart(2, '0')}`
}

export function targetLabel(goal: Pick<Goal, 'metric' | 'targetUnits'>): string {
  if (goal.metric === 'custom' || goal.metric === 'daily') return ''
  if (goal.metric === 'bankroll') return formatMoneyUsd(goal.targetUnits)
  return `${groupThousands(goal.targetUnits)} ${pluralTournaments(goal.targetUnits)}`
}

export function currentLabel(metric: GoalMetric, current: number): string {
  if (metric === 'custom' || metric === 'daily') return ''
  if (metric === 'bankroll') return formatMoneyUsd(current)
  return `${groupThousands(current)} ${pluralTournaments(current)}`
}

export function checklistProgressLabel(checklist: { status: ChecklistStatus }[]): string {
  const completed = checklist.filter((item) => item.status === 'completed').length
  const partial = checklist.filter((item) => item.status === 'partial').length
  const mod10 = checklist.length % 10
  const mod100 = checklist.length % 100
  const noun = mod10 === 1 && mod100 !== 11 ? 'пункта' : 'пунктов'
  const base = checklist.length === 0 ? '0 из 0 пунктов' : `${completed} из ${checklist.length} ${noun}`
  return partial > 0 ? `${base} · ${partial} частично` : base
}

export function goalPhrase(goal: { metric: GoalMetric; targetUnits: number; title?: string | null }): string {
  if (goal.metric === 'custom' || goal.metric === 'daily') return goal.title?.trim() || (goal.metric === 'daily' ? 'Ежедневное дело' : 'Своя цель')
  if (goal.metric === 'bankroll') return `Банкролл до ${formatMoneyUsd(goal.targetUnits)}`
  return `Сыграть ${groupThousands(goal.targetUnits)} ${pluralTournaments(goal.targetUnits)}`
}

export function formatDateShort(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

const MONTH_NAMES = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'] as const

export function currentMonthKey(d: Date = new Date()): string {
  return dayKey(d).slice(0, 7)
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
}

export function monthStart(month: string): string {
  return `${month}-01`
}

export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${month}-${String(last).padStart(2, '0')}`
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-')
  const name = MONTH_NAMES[Number(m) - 1]
  if (!name) return month
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`
}

export function pluralDays(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'день'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня'
  return 'дней'
}

export function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function daysBetween(fromDayKey: string, toDayKey: string): number {
  return Math.round((Date.parse(toDayKey) - Date.parse(fromDayKey)) / 86_400_000)
}

export interface GoalTimeLabel {
  text: string
  overdue: boolean
}

export function goalTimeLabel(goal: Pick<Goal, 'deadline' | 'createdAt'>, today: string = dayKey(new Date())): GoalTimeLabel {
  if (goal.deadline) {
    const left = daysBetween(today, goal.deadline)
    if (left < 0) return { text: 'Дедлайн истек', overdue: true }
    if (left === 0) return { text: 'Дедлайн сегодня', overdue: false }
    return { text: left === 1 ? 'Остался 1 день' : `Осталось ${left} ${pluralDays(left)}`, overdue: false }
  }
  const passed = daysBetween(goal.createdAt.slice(0, 10), today)
  if (passed <= 0) return { text: 'В процессе: сегодня', overdue: false }
  return { text: passed === 1 ? 'В процессе: 1 день' : `В процессе: ${passed} ${pluralDays(passed)}`, overdue: false }
}